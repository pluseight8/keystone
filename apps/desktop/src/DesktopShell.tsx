import React from 'react';
import {
  ActivityBarItem,
  ContextProviderRegistry,
  DesktopShellController,
  DesktopTab,
  DESKTOP_QUICK_CAPTURE_EVENT,
  KeystoneObjectReference,
  PaneNode,
  ShellCommand,
  createDefaultContextRegistry,
  defaultShellCommands,
  keystoneLinkForReference,
  isPrimaryModifier,
  objectTitle,
  parseKeystoneLink,
  resolveOmniboxInput,
} from './desktop-shell-model';
import './desktop-shell.css';
import './desktop-productization.css';
import logoUrl from '../../../branding/logos/logo.png';
import logoLockupUrl from '../../../branding/logos/logo+text-of-logo.png';
import { Icon, IconButton, type IconName } from './desktop-icons';
import { type DesktopPreferences } from './desktop-preferences';
import {
  applyDesktopSettings,
  DESKTOP_ACCENTS,
  desktopThemeColors,
  DesktopSettingsStore,
  DESKTOP_SETTING_REGISTRY,
  findDesktopShortcutConflicts,
  isDesktopSessionRestoreEnabled,
  settingsForCategory,
  type DesktopColorOverrides,
  type DesktopPresetId,
  type DesktopSettingDefinition,
  type DesktopSettingCategory,
  type DesktopSettingId,
  type DesktopSettingScope,
  type DesktopSettingsContext,
  type DesktopSettingsDocument,
  type DesktopSettingsImportPreview,
  type DesktopSettingsSnapshot,
  type DesktopShortcutConflict,
  type HomeSectionId,
  validateCustomCss,
} from './desktop-settings';
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
import { getLocalDesktopProfile } from './desktop-local-runtime';
import { getDesktopMusicRuntime, getDesktopShortsRuntime, getDesktopVideoRuntime, subscribeDesktopMusicRuntime, subscribeDesktopShortsRuntime, subscribeDesktopVideoRuntime, type DesktopMusicRuntime, type DesktopShortsRuntime, type DesktopVideoRuntime } from './desktop-media-runtime';
import { pickDesktopFile } from './desktop-host-bridge';
import { getDesktopAIRuntime, subscribeDesktopAIRuntime, type DesktopAIRuntime, type DesktopLocalAIProviderKind, type DesktopLocalAIModel } from './desktop-ai-runtime';
import { getDesktopDiscoveryRuntime, subscribeDesktopDiscoveryRuntime, type DesktopDiscoveryRuntime } from './desktop-discovery-runtime';
import { createDesktopAIConversation, readDesktopAIConversations, writeDesktopAIConversations, type DesktopAIConversation } from './desktop-ai-conversations';
import { getDesktopNetworkRuntime, subscribeDesktopNetworkRuntime, type DesktopNetworkRuntime } from './desktop-network-runtime';
import type { CaptureDestinationKind } from '@keystone/core';
import { captureAccessLabel, captureDestinationLabel, captureSourceLabel, captureStateLabel, formatBytes, formatCalendarTime, formatMediaDuration, errorText, formatTimestamp, networkReachabilityLabel, networkStateLabel, ruPlural, taskPriorityLabel, taskStatusLabel } from './desktop-format';
import { desktopWindowBridge, getDesktopWindowContext, isDesktopAltF4, observeDesktopWindowGeometry, requestDesktopQuit, restoreDetachedWindows } from './desktop-window-runtime';
import { createDesktopActionCommands } from './desktop-actions';
import { CommandPalette } from './desktop-command-palette';
import { DocumentsSurface } from './desktop-documents-surface';
import { TypedReferenceDock } from './desktop-reference-dock';
import { cloneDesktopTransferTab, createDesktopTransferId, DESKTOP_TAB_TRANSFER_DATA, DESKTOP_WINDOW_TRANSFER_DOM_EVENT, DESKTOP_WINDOW_TRANSFER_STORAGE_KEY, emitDesktopWindowTransfer, listenDesktopWindowTransfers, parseDesktopWindowTransferEvent, type DesktopWindowTransferEvent, type DesktopWindowTransferStart } from './desktop-window-transfer';

type Locale = 'en' | 'ru';

const copy = {
  en: {
    capture: 'Quick Capture', captureHint: 'Save text, links, files and references to your private space.', capturePlaceholder: 'Paste text or an https:// URL…', captureClipboard: 'Capture clipboard once', captureBrowser: 'Capture current page', captureSelection: 'Capture selection', captureDrop: 'Drop a file or folder here', captureTray: 'Private capture', captureNoRuntime: 'Capture is not connected; text input still works locally.', captureNoItems: 'Nothing captured yet.', captureRoute: 'Route', captureDismiss: 'Dismiss', captureRestore: 'Restore', capturePreview: 'Preview destination', captureConfirm: 'Confirm route', captureSource: 'Source', captureState: 'State', captureSuggestions: 'Suggestions', captureUnsafe: 'Only safe HTTP(S) links and Keystone links are accepted.',
    inbox: 'Inbox', mail: 'External Email',
    subscriptions: 'Subscriptions',
    nearby: 'Nearby Exchange',
    nearbyTitle: 'Nearby Exchange', nearbyBoundary: 'Nearby discovery is anonymous. Transfers stay encrypted and start only after your action.', nearbyUnavailable: 'Nearby exchange is not connected.', nearbyReceive: 'Receive nearby', nearbyStop: 'Stop receiving', nearbyQr: 'Show Receive QR', nearbyRefresh: 'Refresh nearby', nearbyNoEndpoints: 'No nearby devices are visible.', nearbyOffers: 'Incoming offers', nearbyNoOffers: 'No offers awaiting consent.', nearbyAccept: 'Accept', nearbyReject: 'Reject', nearbyCancel: 'Cancel', nearbyResume: 'Resume', nearbyDisclosure: 'Identity is anonymous until you explicitly choose fields to disclose.', nearbyAddContact: 'Add Contact after disclosure', nearbyAnonymity: 'No GPS, distance tracking, encounter history or automatic contact creation.', nearbyReceived: 'Received', nearbyShareQr: 'Receive QR expires quickly and is only for Nearby Exchange.',
    home: 'Home', search: 'Search', music: 'Music', video: 'Video', shorts: 'Shorts', localAI: 'Local AI', connectivity: 'Connectivity', agent: 'Keystone Assistant', askAgent: 'Ask Keystone…', messages: 'Messages', spaces: 'Spaces', vault: 'Vault', calendar: 'Calendar', contacts: 'Contacts', maps: 'Maps', files: 'Files', documents: 'Documents', media: 'Media', photos: 'Photos', calls: 'Calls', workboard: 'Workboard', webLibrary: 'Web Library', webLibraryDescription: 'Saved pages and Read Later items stay available offline. The reader never contacts external sites.', collaboration: 'Collaboration', continuity: 'Continuity', plugins: 'Plugins', settings: 'Settings', localeUnavailable: 'Calls are not configured on this device yet.', callBoundary: 'Calls need an approved connection method. Recording never starts automatically.', callMediaReady: 'Media ready', callMediaUnavailable: 'Media unavailable', noActiveCall: 'No active call.', callHistory: 'Call history', acceptCall: 'Accept', rejectCall: 'Reject', mute: 'Mute', unmute: 'Unmute', cameraOn: 'Enable camera', cameraOff: 'Disable camera', screenOn: 'Share screen', screenOff: 'Stop screen share', endCall: 'End call',
    back: 'Back', forward: 'Forward', omnibox: 'Search objects, commands, links, or ask Keystone…', command: 'Command palette', new: 'New', workspace: 'Workspace', context: 'Context', agentScope: 'Selected object', ask: 'Ask Keystone', close: 'Close', duplicate: 'Duplicate', pin: 'Pin tab', unpin: 'Unpin tab', splitHorizontal: 'Split horizontally', splitVertical: 'Split vertically', restore: 'Reopen closed tab', customize: 'Customize activity bar', hide: 'Hide', show: 'Show', moveUp: 'Move up', moveDown: 'Move down', empty: 'Open an object to begin', open: 'Open', openInTab: 'Open in new tab', local: 'Local-first', privacy: 'Private context stays on this device', placeholder: 'Not connected yet', placeholderBody: 'This feature will appear when its local connection is ready.', references: 'Linked objects', drop: 'Drop a reference here', related: 'Related objects', properties: 'Properties', links: 'Links', activity: 'Activity', searchHint: 'Search is local and permission-aware.', agentHint: 'Only the selected object is used. Keystone does not send the whole workspace automatically.', send: 'Run locally', noObject: 'No object selected', browserPrivacy: 'Browser pages do not receive Keystone private context automatically.', currentWorkspace: 'Current workspace', newWorkspace: 'New workspace', rename: 'Rename', delete: 'Delete', switcher: 'Switch workspace', done: 'Done', reset: 'Reset', add: 'Add', objectId: 'Object ID', commandHint: 'Type to filter commands…', noCommands: 'No matching commands', tabList: 'Tab list', tabs: 'tabs', navigate: 'Navigate', run: 'Run', source: 'source', sources: 'sources', browser: 'Browser', revisionLabel: 'revision', resume: 'Resume', openInNewWindow: 'Open in new window', moveTabTo: 'Move tab to', mergeWindowInto: 'Merge window into', closeOtherTabs: 'Close other tabs', quickActions: 'Quick actions', message: 'Message', group: 'Group', space: 'Space', note: 'Note', canvas: 'Canvas', event: 'Calendar event', task: 'Task', tasks: 'Tasks', file: 'File', community: 'Community', saved: 'Saved locally', mode: 'Balanced', status: 'Ready', locked: 'Permission required', openBob: 'Open Bob profile', openChat: 'Open chat', openFile: 'Open trip file', openSpace: 'Open Trip space', askAbout: 'Ask about this object', configure: 'Configure', language: 'Language', english: 'English', russian: 'Русский', extensionSlot: 'Extensions run only after your permission.', needsUser: 'Needs owner input', board: 'Board', list: 'List', pause: 'Pause', cancel: 'Cancel', retry: 'Retry', assign: 'Assign', priority: 'Priority', publication: 'Publication', publicationAdapter: 'Publishing becomes available after it is connected in Settings.', publicationDisclosure: 'Drafts stay local until the owner explicitly publishes them. Public content may be cached; unlisted is not secret.', visibility: 'Visibility', public: 'Public', unlisted: 'By link', scoped: 'Scoped', draft: 'Draft', revision: 'Revision', preview: 'Preview', publish: 'Publish', unpublish: 'Unpublish', publishConfirm: 'Publish this content with the selected visibility?', shareLink: 'Keystone link', noPreview: 'No preview available.', continuityTitle: 'Device Continuity', sendToDevice: 'Send to Device', continueOnDevice: 'Continue on Device', deviceInbox: 'Device Inbox', devices: 'Devices', noContinuityRuntime: 'Device-to-device continuity is not connected yet.', noDevices: 'No trusted devices are available.', noInbox: 'No incoming handoffs.', chooseDevice: 'Choose a trusted device', sendWorkspace: 'Send current workspace', continueWorkspace: 'Continue current workspace', refresh: 'Refresh', flush: 'Try delivery', delivered: 'Delivered to device', opened: 'Opened', accepted: 'Accepted', queued: 'Queued', sending: 'Sending', failed: 'Failed', expired: 'Expired', cancelled: 'Cancelled', offline: 'Offline or waiting for a route', available: 'Available', recentlyAvailable: 'Recently available', notAvailable: 'Not available', automaticClipboard: 'Automatic clipboard continuity', automaticClipboardWarning: 'Off by default. Enabling requires explicit owner confirmation and never auto-pastes.', clipboardExplicit: 'Clipboard is explicit-only; no auto-paste or clipboard history is stored.', handoffBoundary: 'Connect a trusted device in Settings. Transfers are encrypted and start only after your action.',
  },
  ru: {
    capture: 'Быстрый захват', captureHint: 'Сохраняйте текст, ссылки, файлы и ссылки на объекты в личное пространство.', capturePlaceholder: 'Вставьте текст или URL https://…', captureClipboard: 'Захватить буфер обмена один раз', captureBrowser: 'Захватить текущую страницу', captureSelection: 'Захватить выделение', captureDrop: 'Перетащите сюда файл или папку', captureTray: 'Личный захват', captureNoRuntime: 'Захват сейчас недоступен; текст можно сохранить локально.', captureNoItems: 'Пока ничего не захвачено.', captureRoute: 'Маршрутизировать', captureDismiss: 'Скрыть', captureRestore: 'Восстановить', capturePreview: 'Предпросмотр назначения', captureConfirm: 'Подтвердить маршрут', captureSource: 'Источник', captureState: 'Состояние', captureSuggestions: 'Предложения', captureUnsafe: 'Принимаются только безопасные HTTP(S)-ссылки и ссылки Keystone.',
    inbox: 'Входящие', mail: 'Внешняя почта',
    subscriptions: 'Подписки',
    nearby: 'Обмен рядом',
    nearbyTitle: 'Обмен рядом', nearbyBoundary: 'Обнаружение рядом анонимно. Передача шифруется и начинается только после вашего действия.', nearbyUnavailable: 'Обмен рядом не подключён.', nearbyReceive: 'Принимать рядом', nearbyStop: 'Остановить приём', nearbyQr: 'Показать QR для приёма', nearbyRefresh: 'Обновить список', nearbyNoEndpoints: 'Устройства рядом не найдены.', nearbyOffers: 'Входящие предложения', nearbyNoOffers: 'Нет предложений, ожидающих согласия.', nearbyAccept: 'Принять', nearbyReject: 'Отклонить', nearbyCancel: 'Отменить', nearbyResume: 'Продолжить', nearbyDisclosure: 'Личность анонимна, пока вы явно не выберете поля для раскрытия.', nearbyAddContact: 'Добавить контакт после раскрытия', nearbyAnonymity: 'Без GPS, отслеживания расстояния, истории встреч и автоматического создания контактов.', nearbyReceived: 'Получено', nearbyShareQr: 'QR для приёма быстро истекает и используется только для обмена рядом.',
    home: 'Главная', search: 'Поиск', music: 'Музыка', video: 'Видео', shorts: 'Shorts', localAI: 'Локальный AI', connectivity: 'Связь', agent: 'Помощник Keystone', askAgent: 'Спросить Keystone…', messages: 'Сообщения', spaces: 'Пространства', vault: 'Хранилище', calendar: 'Календарь', contacts: 'Контакты', maps: 'Карты', files: 'Файлы', documents: 'Документы', media: 'Медиа', photos: 'Фотографии', calls: 'Звонки', workboard: 'Рабочая доска', webLibrary: 'Веб-библиотека', webLibraryDescription: 'Сохранённые страницы и материалы «Прочитать позже» доступны офлайн. Встроенный просмотр не обращается к внешним сайтам.', collaboration: 'Совместная работа', continuity: 'Связь между устройствами', plugins: 'Плагины', settings: 'Настройки', localeUnavailable: 'Звонки пока не настроены на этом устройстве.', callBoundary: 'Для звонков нужно подключить разрешённый способ связи. Запись не выполняется автоматически.', callMediaReady: 'Медиа готово', callMediaUnavailable: 'Медиа недоступно', noActiveCall: 'Активного звонка нет.', callHistory: 'История звонков', acceptCall: 'Принять', rejectCall: 'Отклонить', mute: 'Выключить микрофон', unmute: 'Включить микрофон', cameraOn: 'Включить камеру', cameraOff: 'Выключить камеру', screenOn: 'Показать экран', screenOff: 'Остановить показ экрана', endCall: 'Завершить звонок',
    back: 'Назад', forward: 'Вперёд', omnibox: 'Поиск объектов, команд, ссылок или вопрос Keystone…', command: 'Палитра команд', new: 'Новое', workspace: 'Рабочее пространство', context: 'Контекст', agentScope: 'Выбранный объект', ask: 'Спросить Keystone', close: 'Закрыть', duplicate: 'Дублировать', pin: 'Закрепить вкладку', unpin: 'Открепить вкладку', splitHorizontal: 'Разделить горизонтально', splitVertical: 'Разделить вертикально', restore: 'Открыть закрытую вкладку', customize: 'Настроить панель действий', hide: 'Скрыть', show: 'Показать', moveUp: 'Вверх', moveDown: 'Вниз', empty: 'Откройте объект, чтобы начать', open: 'Открыть', openInTab: 'Открыть в новой вкладке', local: 'Сначала локально', privacy: 'Приватный контекст остаётся на устройстве', placeholder: 'Пока недоступно', placeholderBody: 'Эта возможность появится после подключения локального источника.', references: 'Связанные объекты', drop: 'Перетащите ссылку сюда', related: 'Связанные объекты', properties: 'Свойства', links: 'Связи', activity: 'Активность', searchHint: 'Поиск локальный и проверяет разрешения.', agentHint: 'Используется только выбранный объект. Keystone не отправляет всё рабочее пространство автоматически.', send: 'Выполнить локально', noObject: 'Объект не выбран', browserPrivacy: 'Страницы браузера не получают приватный контекст Keystone автоматически.', currentWorkspace: 'Текущее пространство', newWorkspace: 'Новое пространство', rename: 'Переименовать', delete: 'Удалить', switcher: 'Сменить рабочее пространство', done: 'Готово', reset: 'Сбросить', add: 'Добавить', objectId: 'ID объекта', commandHint: 'Введите для фильтрации команд…', noCommands: 'Команды не найдены', tabList: 'Список вкладок', tabs: 'вкладок', navigate: 'Навигация', run: 'Выполнить', source: 'источник', sources: 'источники', browser: 'Браузер', revisionLabel: 'версия', resume: 'Продолжить', openInNewWindow: 'Открыть в новом окне', moveTabTo: 'Переместить вкладку в', mergeWindowInto: 'Объединить окно в', closeOtherTabs: 'Закрыть остальные вкладки', quickActions: 'Быстрые действия', message: 'Сообщение', group: 'Группа', space: 'Пространство', note: 'Заметка', canvas: 'Холст', event: 'Событие календаря', task: 'Задача', tasks: 'Задачи', file: 'Файл', community: 'Сообщество', saved: 'Сохранено локально', mode: 'Сбалансированный', status: 'Готов', locked: 'Требуется разрешение', openBob: 'Открыть профиль Боба', openChat: 'Открыть чат', openFile: 'Открыть файл поездки', openSpace: 'Открыть пространство поездки', askAbout: 'Спросить об этом объекте', configure: 'Настроить', language: 'Язык', english: 'English', russian: 'Русский', extensionSlot: 'Расширения работают только после вашего разрешения.', needsUser: 'Нужен ответ владельца', board: 'Доска', list: 'Список', pause: 'Пауза', cancel: 'Отменить', retry: 'Повторить', assign: 'Назначить', priority: 'Приоритет', publication: 'Публикация', publicationAdapter: 'Публикация станет доступна после подключения в настройках.', publicationDisclosure: 'Черновики остаются локальными, пока владелец явно не опубликует их. Публичные данные могут кэшироваться; «по ссылке» — не секрет.', visibility: 'Видимость', public: 'Публично', unlisted: 'По ссылке', scoped: 'Ограниченная', draft: 'Черновик', revision: 'Версия', preview: 'Предпросмотр', publish: 'Опубликовать', unpublish: 'Снять с публикации', publishConfirm: 'Опубликовать содержимое с выбранной видимостью?', shareLink: 'Ссылка Keystone', noPreview: 'Предпросмотр недоступен.', continuityTitle: 'Связь устройств', sendToDevice: 'Отправить на устройство', continueOnDevice: 'Продолжить на устройстве', deviceInbox: 'Входящие устройства', devices: 'Устройства', noContinuityRuntime: 'Связь между устройствами пока не подключена.', noDevices: 'Нет доступных доверенных устройств.', noInbox: 'Входящих передач нет.', chooseDevice: 'Выберите доверенное устройство', sendWorkspace: 'Отправить текущее пространство', continueWorkspace: 'Продолжить текущее пространство', refresh: 'Обновить', flush: 'Попробовать доставить', delivered: 'Доставлено на устройство', opened: 'Открыто', accepted: 'Принято', queued: 'В очереди', sending: 'Отправляется', failed: 'Ошибка', expired: 'Истёк срок', cancelled: 'Отменено', offline: 'Офлайн или нет маршрута', available: 'Доступно', recentlyAvailable: 'Недавно доступно', notAvailable: 'Недоступно', automaticClipboard: 'Автоматическая связь буфера обмена', automaticClipboardWarning: 'Выключено по умолчанию. Включение требует явного подтверждения владельца и не вставляет текст автоматически.', clipboardExplicit: 'Буфер обмена работает только явно: автозаполнение и история буфера не используются.', handoffBoundary: 'Подключите доверенное устройство в настройках. Передача шифруется и запускается только после вашего действия.',
  },
} as const;

type Copy = { [K in keyof typeof copy.en]: string };

function useShell(): [DesktopShellController, () => void] {
  const controller = React.useRef<DesktopShellController>();
  const windowContext = React.useRef(getDesktopWindowContext()).current;
  controller.current ??= new DesktopShellController({ canOpen: ref => ref.visibility !== 'private' || ref.id !== 'revoked', windowId: windowContext.windowId, detachedTabId: windowContext.detachedTabId, startupMode: windowContext.isPrimary && !isDesktopSessionRestoreEnabled() ? 'clean' : 'restore' });
  const [, redraw] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => controller.current?.subscribe(redraw), []);
  React.useEffect(() => {
    const shell = controller.current;
    if (!shell) return undefined;
    shell.setWindowBridge(desktopWindowBridge());
    let cancelled = false;
    const secondaryRefreshTimers = windowContext.isPrimary ? [] : [0, 80, 180, 360, 720].map(delay => window.setTimeout(() => {
      if (!cancelled) shell.refreshFromStorage();
    }, delay));
    let stopGeometry: () => void = () => undefined;
    void observeDesktopWindowGeometry(windowContext.windowId, geometry => shell.setWindowGeometry(geometry), () => shell.handleNativeWindowClose()).then(stop => {
      if (cancelled) stop();
      else stopGeometry = stop;
    });
    const onStorage = (event: StorageEvent) => {
      shell.refreshFromStorage();
      if (event.key !== DESKTOP_WINDOW_TRANSFER_STORAGE_KEY || !event.newValue) return;
      const transfer = parseDesktopWindowTransferEvent(event.newValue);
      if (transfer) window.dispatchEvent(new CustomEvent<DesktopWindowTransferEvent>(DESKTOP_WINDOW_TRANSFER_DOM_EVENT, { detail: transfer }));
    };
    const onBeforeUnload = () => shell.flush();
    window.addEventListener('storage', onStorage);
    window.addEventListener('beforeunload', onBeforeUnload);
    let stopTransfers: () => void = () => undefined;
    void listenDesktopWindowTransfers(event => {
      window.dispatchEvent(new CustomEvent<DesktopWindowTransferEvent>(DESKTOP_WINDOW_TRANSFER_DOM_EVENT, { detail: event }));
      if ((event.type === 'committed' && event.targetWindowId === shell.windowId) || (event.type === 'accepted' && (event.sourceWindowId === shell.windowId || event.targetWindowId === shell.windowId))) shell.refreshFromStorage();
    }).then(stop => {
      if (cancelled) stop();
      else stopTransfers = stop;
    });
    return () => { cancelled = true; secondaryRefreshTimers.forEach(timer => window.clearTimeout(timer)); stopGeometry(); stopTransfers(); window.removeEventListener('storage', onStorage); window.removeEventListener('beforeunload', onBeforeUnload); shell.flush(); };
  }, [windowContext.isPrimary, windowContext.windowId]);
  return [controller.current, redraw];
}

export interface DesktopShellProps {
  initialLocale?: Locale;
  onLocaleChange?: (locale: Locale) => void;
  startupNotice?: string;
}

export default function DesktopShell({ initialLocale = 'ru', onLocaleChange, startupNotice }: DesktopShellProps) {
  const [shell] = useShell();
  const [locale, setLocaleState] = React.useState<Locale>(() => {
    const saved = localStorage.getItem('keystone.locale');
    return saved === 'ru' || saved === 'en' ? saved : initialLocale;
  });
  // Screen readers and hyphenation pick the language from <html lang>.
  React.useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  React.useEffect(() => { if (startupNotice) shell.setNotice(startupNotice); }, [shell, startupNotice]);
  const settingsStoreRef = React.useRef<DesktopSettingsStore>();
  settingsStoreRef.current ??= new DesktopSettingsStore();
  const settingsStore = settingsStoreRef.current;
  const [settingsRevision, redrawSettings] = React.useReducer(value => value + 1, 0);
  const t: Copy = {
    ...copy[locale],
    local: locale === 'ru' ? 'На устройстве' : 'On this device',
    placeholder: locale === 'ru' ? 'Недоступно пока' : 'Unavailable for now',
    placeholderBody: locale === 'ru' ? 'Эта возможность появится после подключения соответствующего локального сервиса.' : 'This feature will appear when its local service is connected.',
    references: locale === 'ru' ? 'Связанные объекты' : 'Linked objects',
    captureNoRuntime: locale === 'ru' ? 'Текст можно сохранять уже сейчас; для выбора файлов подключите системный импорт.' : 'Text capture is ready; connect the system importer to choose files.',
    captureUnsafe: locale === 'ru' ? 'Принимаются только безопасные HTTP(S)-ссылки и ссылки Keystone.' : 'Only safe HTTP(S) and Keystone links are accepted.',
    nearbyBoundary: locale === 'ru' ? 'Обмен рядом работает только после явного включения и подтверждения каждого действия.' : 'Nearby sharing starts only after explicit enablement and confirmation of each action.',
    nearbyUnavailable: locale === 'ru' ? 'Обмен рядом пока не подключён.' : 'Nearby sharing is not connected yet.',
    localeUnavailable: locale === 'ru' ? 'Звонки пока не настроены на этом устройстве.' : 'Calls are not configured on this device yet.',
    callBoundary: locale === 'ru' ? 'Для звонков нужно подключить разрешённый способ связи. Запись не выполняется автоматически.' : 'Calls need an approved connection method. Recording never starts automatically.',
    callMediaReady: locale === 'ru' ? 'Медиа готово' : 'Media ready',
    callMediaUnavailable: locale === 'ru' ? 'Медиа недоступно' : 'Media unavailable',
    publicationAdapter: locale === 'ru' ? 'Публикация станет доступна после подключения её в настройках.' : 'Publishing becomes available after it is connected in Settings.',
    noContinuityRuntime: locale === 'ru' ? 'Связь между устройствами пока не подключена.' : 'Device-to-device continuity is not connected yet.',
    handoffBoundary: locale === 'ru' ? 'Подключите доверенное устройство в настройках. Передача шифруется и запускается только после вашего действия.' : 'Connect a trusted device in Settings. Transfers are encrypted and start only after your action.',
    extensionSlot: locale === 'ru' ? 'Расширения работают только после вашего разрешения.' : 'Extensions run only after your permission.',
    captureHint: locale === 'ru' ? 'Сохраняйте текст, ссылки и файлы в личную папку захвата.' : 'Save text, links, and files to your private capture tray.',
    nearbyTitle: locale === 'ru' ? 'Обмен рядом' : 'Nearby sharing',
    nearbyReceive: locale === 'ru' ? 'Принимать рядом' : 'Receive nearby',
    nearbyStop: locale === 'ru' ? 'Остановить приём' : 'Stop receiving',
    nearbyRefresh: locale === 'ru' ? 'Обновить' : 'Refresh',
    nearbyNoEndpoints: locale === 'ru' ? 'Устройства рядом не найдены.' : 'No nearby devices found.',
    nearbyOffers: locale === 'ru' ? 'Входящие предложения' : 'Incoming offers',
    nearbyNoOffers: locale === 'ru' ? 'Нет предложений, ожидающих согласия.' : 'No offers awaiting consent.',
    nearbyDisclosure: locale === 'ru' ? 'Личность остаётся скрытой, пока вы сами не выберете, что показать.' : 'Your identity stays private until you choose what to share.',
    nearbyAnonymity: locale === 'ru' ? 'Геопозиция и история встреч не сохраняются автоматически.' : 'Location and encounter history are never stored automatically.',
    continuityTitle: locale === 'ru' ? 'Связь устройств' : 'Device continuity',
    webLibraryDescription: locale === 'ru' ? 'Сохранённые страницы и материалы для чтения без сети.' : 'Saved pages and reading material available offline.',
  };
  const [omnibox, setOmnibox] = React.useState('');
  const [omniboxOpen, setOmniboxOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = React.useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = React.useState(false);
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
  const [activityEditorOpen, setActivityEditorOpen] = React.useState(false);
  const [draggedRef, setDraggedRef] = React.useState<KeystoneObjectReference>();
  const [agentPrefill, setAgentPrefill] = React.useState('');
  const omniboxRef = React.useRef<HTMLInputElement>(null);
  const commands = React.useMemo(() => {
    const merged = [...defaultShellCommands(locale), ...createDesktopActionCommands(locale)];
    return merged.filter((command, index) => merged.findIndex(candidate => candidate.id === command.id) === index);
  }, [locale]);
  const contextRegistry = React.useMemo(() => createDefaultContextRegistry(locale), [locale]);
  const snapshot = shell.getSnapshot();
  const currentTab = shell.currentTab;
  const localProfile = getLocalDesktopProfile();
  const settingsContext = { deviceId: localProfile?.deviceId, workspaceId: snapshot.workspace.id, windowId: shell.windowId } as const;
  const settings = React.useMemo(() => settingsStore.effective(settingsContext), [settingsStore, settingsContext.deviceId, settingsContext.workspaceId, settingsContext.windowId, settingsRevision]);
  const startupSessionPolicyApplied = React.useRef(false);
  React.useEffect(() => {
    if (!shell.isPrimaryWindow || startupSessionPolicyApplied.current) return undefined;
    startupSessionPolicyApplied.current = true;
    const restoreTabs = settings.values['tabs.restoreTabs'] === true;
    const restoreWindows = settings.values['behavior.restoreWindows'] === true;
    const sessionRestoreEnabled = isDesktopSessionRestoreEnabled();
    if (!sessionRestoreEnabled || !restoreTabs) {
      // Only tell the user about a reset when it actually discarded a previous session.
      const discarded = snapshot.workspace.tabs.length > 1 || shell.listWindows().length > 1;
      shell.resetWindowAndTabLayout({ preserveTabs: false });
      if (!sessionRestoreEnabled) settingsStore.disableAutomaticSessionRestore();
      if (discarded) shell.setNotice(locale === 'ru' ? 'Открыта только новая главная вкладка.' : 'Only a fresh Home tab was opened.');
      return undefined;
    }
    if (!restoreWindows) {
      shell.consolidateWindows();
      return undefined;
    }
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      await restoreDetachedWindows(shell.listWindows(), { isPrimary: shell.isPrimaryWindow });
    });
    return () => { cancelled = true; };
  }, [locale, settings.values['behavior.restoreWindows'], settings.values['tabs.restoreTabs'], shell]);
  React.useEffect(() => {
    const configuredLocale = settings.values['general.locale'];
    if (configuredLocale !== locale) setLocaleState(configuredLocale);
  }, [locale, settings.values['general.locale']]);
  React.useEffect(() => {
    const openQuickCapture = () => { setQuickActionsOpen(false); setQuickCaptureOpen(true); };
    window.addEventListener(DESKTOP_QUICK_CAPTURE_EVENT, openQuickCapture);
    return () => window.removeEventListener(DESKTOP_QUICK_CAPTURE_EVENT, openQuickCapture);
  }, []);
  const avatarLabel = localStorage.getItem('keystone.local.avatar.v1')?.trim().slice(0, 2).toUpperCase()
    || localProfile?.displayName.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()
    || 'K';

  const setLocale = (next: Locale) => { setLocaleState(next); localStorage.setItem('keystone.locale', next); settingsStore.set('general.locale', next, 'global', settingsContext); onLocaleChange?.(next); };
  const updateSetting = React.useCallback((id: DesktopSettingId, value: unknown, scope?: DesktopSettingScope) => {
    const result = settingsStore.set(id, value, scope, settingsContext);
    if (!result.ok) shell.setNotice(result.error ?? 'Could not save this setting.');
  }, [settingsStore, settingsContext, shell]);

  React.useEffect(() => settingsStore.subscribe(redrawSettings), [settingsStore]);
  React.useEffect(() => {
    const onStorage = () => settingsStore.reload();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [settingsStore]);

  React.useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => applyDesktopSettings(settings, Boolean(media?.matches));
    apply();
    if (!media) return undefined;
    media.addEventListener?.('change', apply);
    return () => media.removeEventListener?.('change', apply);
  }, [settings]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const primary = isPrimaryModifier(event);
      if (isDesktopAltF4(event)) { event.preventDefault(); void requestDesktopQuit(); return; }
      if (event.defaultPrevented || event.isComposing || paletteOpen) return;
      if (matchesShortcut(event, settings.values['shortcuts.commandPalette']) || (isPrimaryModifier(event) && event.key.toLowerCase() === 'p')) { event.preventDefault(); setPaletteOpen(true); return; }
      if (matchesShortcut(event, settings.values['shortcuts.quit']) || (primary && event.key.toLowerCase() === 'q')) { event.preventDefault(); void requestDesktopQuit(); return; }
      if (matchesShortcut(event, settings.values['shortcuts.focusOmnibox'])) { event.preventDefault(); omniboxRef.current?.focus(); omniboxRef.current?.select(); setOmniboxOpen(true); return; }
      if (matchesShortcut(event, settings.values['shortcuts.reopenTab'])) { event.preventDefault(); shell.reopenClosedTab(); return; }
      if (matchesShortcut(event, settings.values['shortcuts.newTab'])) { event.preventDefault(); shell.openReference({ kind: 'home', id: 'new-tab', label: t.home }, { allowDuplicate: true }); return; }
      if (matchesShortcut(event, settings.values['shortcuts.closeTab'])) { event.preventDefault(); shell.closeActiveTab(); return; }
      if (primary && event.key === '\\') { event.preventDefault(); shell.splitPane('vertical'); return; }
      if (primary && event.key === 'Tab') { event.preventDefault(); shell.nextTab(event.shiftKey ? -1 : 1); return; }
      if (matchesShortcut(event, settings.values['shortcuts.quickCapture'])) { event.preventDefault(); setQuickActionsOpen(false); setQuickCaptureOpen(true); return; }
      if (matchesShortcut(event, settings.values['shortcuts.toggleSidebar'])) { event.preventDefault(); shell.toggleContextSidebar(); return; }
      if (matchesShortcut(event, settings.values['shortcuts.customize'])) { event.preventDefault(); shell.openReference({ kind: 'settings', id: 'customize', label: locale === 'ru' ? 'Настроить Keystone' : 'Customize Keystone' }); return; }
      if (primary && event.code === 'Space') { event.preventDefault(); shell.toggleAgentPanel(true); return; }
      if (event.key === 'Escape') { setPaletteOpen(false); setQuickActionsOpen(false); setQuickCaptureOpen(false); setWorkspaceOpen(false); setActivityEditorOpen(false); setOmniboxOpen(false); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shell, settings, locale, paletteOpen, t.home]);

  const runCommand = (command: ShellCommand) => { setPaletteOpen(false); command.run(shell); };
  const submitOmnibox = (event: React.FormEvent) => {
    event.preventDefault();
    const input = omnibox.trim();
    if (!input) return;
    if (/^keystone:\/\/capture\?/i.test(input)) {
      const captureRuntime = getDesktopCaptureRuntime();
      if (captureRuntime) void captureRuntime.captureDeepLink(input).then(() => { shell.openReference({ kind: 'capture', id: 'capture', label: t.capture }); }).catch(error => shell.setNotice(error instanceof Error ? error.message : t.captureUnsafe));
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
    } else if (result.type === 'agent-query' || result.type === 'search') {
      shell.openReference({ kind: 'settings', id: 'search', label: t.search, query: result.command ?? input }, { allowDuplicate: Boolean(result.command) });
    }
    setOmnibox(''); setOmniboxOpen(false);
  };

  const activeRef = currentTab?.object;
  const browserPage = currentTab?.kind === 'browser' ? shell.browserPage(currentTab.id) : undefined;
  const context = contextRegistry.resolve(activeRef, browserPage);
  const chrome = shell.chromeState;
  const visibleActivity = chrome.activityBar.filter(item => item.visible);
  const activeActivityId = currentTab?.kind === 'settings' && currentTab.object?.id === 'search' ? 'search'
    : currentTab?.kind === 'settings' && currentTab.object?.id === 'device' ? 'device'
      : currentTab?.kind === 'settings' ? 'settings'
      : currentTab?.kind === 'document' ? 'document'
        : currentTab?.kind === 'capture' ? 'capture'
          : currentTab?.kind === 'tasks' ? 'tasks'
            : currentTab?.kind === 'home' ? 'home'
                : currentTab?.kind;
  const openActivity = (item: ActivityBarItem, options: { readonly newTab?: boolean } = {}) => {
    const allowDuplicate = options.newTab === true;
    if (item.kind === 'search') {
      shell.openReference({ kind: 'settings', id: 'search', label: t.search }, { allowDuplicate });
      return;
    }
    if (item.kind === 'plugins') { shell.openReference({ kind: 'settings', id: 'plugins', label: t.plugins }, { allowDuplicate }); return; }
    if (item.id === 'inbox') { shell.openReference({ kind: 'inbox', id: 'inbox', label: t.inbox }, { allowDuplicate }); return; }
    if (item.id === 'continuity') { shell.openReference({ kind: 'settings', id: 'continuity', label: t.continuity }, { allowDuplicate }); return; }
    if (item.id === 'nearby') { shell.openReference({ kind: 'settings', id: 'nearby', label: t.nearby }, { allowDuplicate }); return; }
    if (item.id === 'web-library') { shell.openReference({ kind: 'web-library', id: 'web-library', label: t.webLibrary }, { allowDuplicate }); return; }
    if (item.id === 'capture') {
      if (allowDuplicate) shell.openReference({ kind: 'capture', id: 'capture', label: t.capture }, { allowDuplicate: true });
      else setQuickCaptureOpen(true);
      return;
    }
    if (item.id === 'device') { shell.openReference({ kind: 'settings', id: 'device', label: t.settings }, { allowDuplicate }); return; }
    shell.openReference({ kind: item.kind, id: item.id === 'calls' ? 'calls' : item.kind, label: activityLabel(item, t) }, { allowDuplicate });
  };

  return <div className="desktop-shell" data-locale={locale} data-keystone-shell="true">
    {settings.values['layout.activityBarVisible'] && <ActivityBar items={visibleActivity} activeId={activeActivityId} t={t} onOpen={openActivity} onCustomize={() => setActivityEditorOpen(value => !value)} />}
    <div className="desktop-environment">
      <header className="desktop-header" data-keystone-region="toolbar">
        <div className="desktop-brand"><img className="brand-lockup" src={logoLockupUrl} alt="Keystone" /></div>
        <div className="history-controls"><IconButton className="icon-control" icon="chevron-left" label={t.back} onClick={() => shell.goBack()} /><IconButton className="icon-control" icon="chevron-right" label={t.forward} onClick={() => shell.goForward()} /></div>
        {settings.values['layout.omniboxVisible'] && <form className="omnibox" onSubmit={submitOmnibox} data-keystone-component="omnibox">
          <span className="omnibox-symbol" aria-hidden><Icon name="search" size={15} /></span><input ref={omniboxRef} value={omnibox} onFocus={() => setOmniboxOpen(true)} onChange={event => setOmnibox(event.target.value)} placeholder={locale === 'ru' ? 'Поиск, команды, ссылки…' : 'Search, commands, links…'} aria-label={t.omnibox}/><kbd>{isMac() ? '⌘' : 'Ctrl'} L</kbd>
          {omniboxOpen && <OmniboxMenu value={omnibox} t={t} onChoose={value => { setOmnibox(value); omniboxRef.current?.focus(); }} />}
        </form>}
        {settings.values['layout.workspaceSelectorVisible'] && <div className="header-workspace"><button className="workspace-switcher" onClick={() => setWorkspaceOpen(value => !value)} aria-expanded={workspaceOpen}><span className="workspace-dot"/><span>{snapshot.workspace.name}</span><Icon name="chevron-down" size={13} className="chevron" /></button>{workspaceOpen && <WorkspaceMenu shell={shell} t={t} onClose={() => setWorkspaceOpen(false)} />}</div>}
        <div className="header-actions">
          {settings.values['layout.commandPaletteButtonVisible'] && <button className="quiet-button" onClick={() => setPaletteOpen(true)} title={t.command}><Icon name="command" size={15} /><span>{t.command}</span></button>}
          {settings.values['layout.newButtonVisible'] && <button className="primary-button" onClick={() => setQuickActionsOpen(value => !value)} aria-expanded={quickActionsOpen}><Icon name="plus" size={15} />{t.new}</button>}
          <select className="locale-select" value={locale} onChange={event => setLocale(event.target.value as Locale)} aria-label={t.language}><option value="en">{t.english}</option><option value="ru">{t.russian}</option></select>
          <button className="avatar-button" onClick={() => shell.openReference({ kind: 'settings', id: 'settings', label: t.settings })} aria-label={t.settings}>{avatarLabel}</button>
        </div>
        {quickActionsOpen && <QuickActions t={t} onChoose={action => { setQuickActionsOpen(false); shell.openReference(action, { allowDuplicate: true }); }} onCapture={() => { setQuickActionsOpen(false); setQuickCaptureOpen(true); }} onNewTab={() => { setQuickActionsOpen(false); shell.openReference({ kind: 'home', id: 'new-tab', label: t.home }, { allowDuplicate: true }); }} />}
      </header>
      <TabStrip shell={shell} tabs={shell.currentTabs()} currentTab={currentTab} t={t} settings={settings} />
      <div className="desktop-body" data-keystone-region="content" style={{ '--context-width': `${settings.values['layout.sidebarWidth']}px`, '--agent-width': `${settings.values['layout.inspectorWidth']}px` } as React.CSSProperties} data-context-open={chrome.contextSidebarOpen && settings.values['layout.sidebarVisible'] ? 'true' : 'false'} data-agent-open={chrome.agentPanelOpen && settings.values['layout.inspectorVisible'] ? 'true' : 'false'}>
        <main className="pane-host" aria-label={t.workspace} onDragOver={event => event.preventDefault()} onDrop={event => handleDrop(event, shell, draggedRef, shell.currentPaneId)}>
          <PaneTree node={snapshot.workspace.paneTree} shell={shell} t={t} contextRegistry={contextRegistry} onDragRef={setDraggedRef} settings={settings} settingsStore={settingsStore} settingsContext={settingsContext} onSettingChange={updateSetting} />
        </main>
        {chrome.contextSidebarOpen && settings.values['layout.sidebarVisible'] && <ContextSidebar data={context} t={t} />}
        {chrome.agentPanelOpen && settings.values['layout.inspectorVisible'] && <AgentBotPanel shell={shell} t={t} activeTab={currentTab} prefill={agentPrefill} onClose={() => shell.toggleAgentPanel(false)} />}
      </div>
      {settings.values['layout.statusBarVisible'] && <footer className="status-bar" data-keystone-region="status-bar"><span><i className="status-light"/> {t.status}</span><span className="status-spacer"/><span>{t.saved}</span></footer>}
      {activityEditorOpen && <ActivityEditor shell={shell} t={t} onClose={() => setActivityEditorOpen(false)} />}
    </div>
    {paletteOpen && <CommandPalette
      commands={commands}
      title={t.command}
      searchLabel={t.commandHint}
      noCommands={t.noCommands}
      keyboardHint={`↑↓ ${t.navigate} · Enter ${t.run.toLowerCase()}`}
      onRun={runCommand}
      onClose={() => setPaletteOpen(false)}
    />}
    {quickCaptureOpen && <QuickCaptureOverlay shell={shell} t={t} onClose={() => setQuickCaptureOpen(false)} />}
    <NoticeToast notice={shell.currentNotice} t={t} onClose={() => shell.clearNotice()} />
  </div>;
}

function isMac(): boolean { return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform); }

function matchesShortcut(event: KeyboardEvent, value: string): boolean {
  const parts = value.split('+').map(part => part.trim().toLowerCase()).filter(Boolean);
  const key = parts.pop();
  if (!key) return false;
  const modifiers = new Set(parts);
  const primaryRequired = modifiers.has('ctrl') || modifiers.has('cmd') || modifiers.has('meta');
  if (primaryRequired) {
    const pressed = modifiers.has('cmd') || modifiers.has('meta') || (isMac() && !modifiers.has('ctrl')) ? event.metaKey : event.ctrlKey;
    if (!pressed) return false;
  }
  if (modifiers.has('alt') && !event.altKey) return false;
  if (modifiers.has('shift') && !event.shiftKey) return false;
  if (!primaryRequired && (event.ctrlKey || event.metaKey)) return false;
  const expected = key === 'space' ? ' ' : key === 'escape' ? 'escape' : key;
  return event.key.toLowerCase() === expected || event.code.toLowerCase() === key || (key === 'space' && event.code === 'Space');
}

function contextualBreadcrumb(tab: DesktopTab | undefined, t: Copy): React.ReactNode {
  if (!tab || tab.kind === 'home' || tab.kind === 'music' || tab.kind === 'video' || tab.kind === 'shorts' || tab.kind === 'ai' || tab.kind === 'network' || tab.kind === 'settings' || tab.kind === 'tasks') return null;
  if (tab.kind === 'graph' || tab.kind === 'canvas' || tab.kind === 'vault') return <><span>{t.vault}</span><b>›</b><strong>{tab.title}</strong></>;
  if (tab.kind === 'document' || tab.kind === 'file') return <><span>{t.files}</span><b>›</b><strong>{tab.title}</strong></>;
  return tab.object?.id && tab.object.id !== tab.kind ? <><span>{objectTitle({ kind: tab.kind, id: tab.kind })}</span><b>›</b><strong>{tab.title}</strong></> : null;
}

function findCommand(commands: ShellCommand[], input: string): ShellCommand | undefined {
  const normalized = input.trim().toLowerCase();
  return commands.find(command => command.available !== false && (command.id === normalized || command.label.toLowerCase() === normalized || command.keywords?.some(keyword => keyword === normalized)));
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

function ActivityBar({ items, activeId, t, onOpen, onCustomize }: { items: ActivityBarItem[]; activeId?: string; t: Copy; onOpen: (item: ActivityBarItem, options?: { readonly newTab?: boolean }) => void; onCustomize: () => void }) {
  const open = (item: ActivityBarItem, event: React.MouseEvent<HTMLButtonElement>) => onOpen(item, { newTab: event.metaKey || event.ctrlKey });
  return <aside className="activity-bar" data-keystone-region="activity-bar" aria-label={t.workspace}><div className="activity-logo" aria-hidden><img src={logoUrl} alt="" /></div><nav>{items.map(item => <button type="button" key={item.id} className={`activity-item${activeId === item.id ? ' active' : ''}`} onClick={event => open(item, event)} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); onOpen(item, { newTab: true }); } }} title={item.extensionSlot ? t.extensionSlot : activityLabel(item, t)} aria-label={activityLabel(item, t)} aria-current={activeId === item.id ? 'page' : undefined}><span className="activity-icon" aria-hidden><Icon name={(item.icon as IconName) || 'circle'} size={18} /></span><span>{activityLabel(item, t)}</span></button>)}</nav><div className="activity-bottom"><button type="button" className="activity-item subtle" onClick={onCustomize} title={t.customize} aria-label={t.customize}><span className="activity-icon" aria-hidden><Icon name="sliders" size={18} /></span><span>{t.configure}</span></button></div></aside>;
}

function activityLabel(item: ActivityBarItem, t: Copy): string {
  const labels: Record<string, string> = { home: t.home, search: t.search, music: t.music, video: t.video, shorts: t.shorts, ai: t.localAI, network: t.connectivity, capture: t.capture, tasks: t.tasks, document: t.documents, device: t.devices, settings: t.settings, inbox: t.inbox, agent: t.agent, chat: t.messages, space: t.spaces, vault: t.vault, calendar: t.calendar, contacts: t.contacts, map: t.maps, mail: t.mail, file: t.files, media: t.photos, calls: t.calls, subscriptions: t.subscriptions, 'web-library': t.webLibrary, continuity: t.continuity, nearby: t.nearby, plugins: t.plugins };
  return labels[item.id] ?? item.label;
}

/** Built-in surfaces are stored with their English model label; show them in the UI locale. */
function tabTitle(tab: DesktopTab, t: Copy): string {
  if (!tab.object || !/^[a-z-]+$/.test(tab.object.id)) return tab.title;
  const key = (Object.keys(copy.en) as (keyof typeof copy.en)[]).find(candidate => copy.en[candidate] === tab.title);
  return key ? t[key] : tab.title;
}

function TabStrip({ shell, tabs, currentTab, t, settings }: { shell: DesktopShellController; tabs: DesktopTab[]; currentTab?: DesktopTab; t: Copy; settings: DesktopSettingsSnapshot }) {
  type LocalDrag = { tabId: string; pointerId: number; startX: number; startY: number; x: number; y: number; targetIndex: number; detachPreview: boolean; moved: boolean; nativeDrag?: boolean; transferTransactionId?: string };
  type IncomingTransfer = { start: DesktopWindowTransferStart; targetIndex: number; pointerInside: boolean; nativeDrag?: boolean };
  const [menu, setMenu] = React.useState<{ tabId: string; x: number; y: number }>();
  const [overflowMenu, setOverflowMenu] = React.useState<{ x: number; y: number }>();
  const [drag, setDrag] = React.useState<LocalDrag>();
  const [incoming, setIncoming] = React.useState<IncomingTransfer>();
  const stripRef = React.useRef<HTMLDivElement>(null);
  const overflowButtonRef = React.useRef<HTMLButtonElement>(null);
  const tabRefs = React.useRef(new Map<string, HTMLDivElement>());
  const tabsRef = React.useRef(tabs);
  const dragRef = React.useRef(drag);
  const incomingRef = React.useRef(incoming);
  const nativeDropRef = React.useRef<string>();
  tabsRef.current = tabs;
  dragRef.current = drag;
  incomingRef.current = incoming;

  React.useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(undefined);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  React.useEffect(() => {
    if (!overflowMenu) return undefined;
    const close = () => setOverflowMenu(undefined);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [overflowMenu]);

  React.useEffect(() => {
    const activeNode = currentTab ? tabRefs.current.get(currentTab.id) : undefined;
    activeNode?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: settings.values['motion.mode'] === 'off' ? 'auto' : 'smooth' });
  }, [currentTab?.id, settings.values['motion.mode']]);

  React.useEffect(() => {
    const onTransfer = (event: Event) => {
      const value = (event as CustomEvent<DesktopWindowTransferEvent>).detail;
      if (!value || value.workspaceId !== shell.getSnapshot().workspace.id) return;
      if (value.type === 'start') {
        if (value.sourceWindowId !== shell.windowId && !tabsRef.current.some(tab => tab.id === value.tabId)) setIncoming({ start: value, targetIndex: tabsRef.current.length, pointerInside: false });
      } else if (value.type === 'cancel') {
        setIncoming(current => current?.start.transactionId === value.transactionId ? undefined : current);
        if (dragRef.current?.transferTransactionId === value.transactionId) {
          clearPointerListeners();
          dragRef.current = undefined;
          setDrag(undefined);
        }
      } else if (value.type === 'accepted' || value.type === 'committed') {
        if (value.sourceWindowId === shell.windowId && dragRef.current?.transferTransactionId === value.transactionId) {
          clearPointerListeners();
          dragRef.current = undefined;
          setDrag(undefined);
        }
        setIncoming(current => current?.start.transactionId === value.transactionId ? undefined : current);
      }
    };
    window.addEventListener(DESKTOP_WINDOW_TRANSFER_DOM_EVENT, onTransfer);
    return () => window.removeEventListener(DESKTOP_WINDOW_TRANSFER_DOM_EVENT, onTransfer);
  }, [shell]);

  const copyLink = async (tab: DesktopTab) => {
    if (!tab.object) { shell.setNotice(t.noObject); return; }
    const link = keystoneLinkForReference(tab.object);
    try { await navigator.clipboard?.writeText(link); shell.setNotice(t.home === 'Главная' ? 'Ссылка скопирована' : 'Link copied'); }
    catch { shell.setNotice(t.home === 'Главная' ? 'Не удалось скопировать ссылку' : 'Could not copy link'); }
  };

  const insertionIndexAt = (clientX: number, ignoreTabId?: string): number => {
    let targetIndex = 0;
    for (const tab of tabsRef.current) {
      if (tab.id === ignoreTabId) continue;
      const rect = tabRefs.current.get(tab.id)?.getBoundingClientRect();
      if (rect && clientX > rect.left + rect.width / 2) targetIndex += 1;
    }
    return Math.max(0, Math.min(tabsRef.current.length, targetIndex));
  };

  const isInsideStrip = (clientX: number, clientY: number): boolean => {
    const bounds = stripRef.current?.getBoundingClientRect();
    return Boolean(bounds && clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom);
  };

  const readSharedTransferStart = (transactionId?: string): DesktopWindowTransferStart | undefined => {
    const value = readSharedTransferEvent(transactionId);
    return value?.type === 'start' ? value : undefined;
  };

  const readSharedTransferEvent = (transactionId?: string): DesktopWindowTransferEvent | undefined => {
    try {
      const raw = window.localStorage.getItem(DESKTOP_WINDOW_TRANSFER_STORAGE_KEY);
      const value = raw ? parseDesktopWindowTransferEvent(raw) : undefined;
      if (!value || (transactionId && value.transactionId !== transactionId)) return undefined;
      return value;
    } catch {
      return undefined;
    }
  };

  const nativeTransferStart = (event: React.DragEvent<HTMLDivElement>): DesktopWindowTransferStart | undefined => {
    try {
      const custom = event.dataTransfer.getData(DESKTOP_TAB_TRANSFER_DATA);
      const embedded = custom ? parseDesktopWindowTransferEvent(custom) : undefined;
      if (embedded?.type === 'start') return embedded;
      const transactionId = custom || event.dataTransfer.getData('text/plain') || undefined;
      return readSharedTransferStart(transactionId);
    } catch {
      return undefined;
    }
  };

  const validIncomingTransfer = (start: DesktopWindowTransferStart | undefined): start is DesktopWindowTransferStart => Boolean(
    start
      && start.workspaceId === shell.getSnapshot().workspace.id
      && start.sourceWindowId !== shell.windowId
      && start.tabId === start.tab.id
      && !tabsRef.current.some(tab => tab.id === start.tabId),
  );

  function clearPointerListeners(): void {
    window.removeEventListener('pointermove', movePointer);
    window.removeEventListener('pointerup', releasePointer);
    window.removeEventListener('pointercancel', cancelPointer);
  }

  React.useEffect(() => {
    if (!incoming) return undefined;
    const updateIncoming = (event: PointerEvent) => {
      const current = incomingRef.current;
      if (!current) return;
      const inside = isInsideStrip(event.clientX, event.clientY);
      setIncoming(previous => previous?.start.transactionId === current.start.transactionId
        ? { ...previous, pointerInside: inside, ...(inside ? { targetIndex: insertionIndexAt(event.clientX) } : {}) }
        : previous);
    };
    const finishIncoming = (event: PointerEvent, cancelled = false) => {
      const current = incomingRef.current;
      if (!current) return;
      if (current.nativeDrag) return;
      const inside = !cancelled && isInsideStrip(event.clientX, event.clientY);
      if (inside) {
        const targetIndex = insertionIndexAt(event.clientX);
        const accepted = shell.acceptWindowTransfer(current.start, targetIndex);
        void emitDesktopWindowTransfer({ type: accepted ? 'accepted' : 'rejected', transactionId: current.start.transactionId, workspaceId: current.start.workspaceId, sourceWindowId: current.start.sourceWindowId, targetWindowId: shell.windowId, tabId: current.start.tabId, targetIndex: accepted ? targetIndex : undefined, ...(accepted ? {} : { reason: 'ownership-check-failed' }) });
      } else {
        void emitDesktopWindowTransfer({ type: 'cancel', transactionId: current.start.transactionId, workspaceId: current.start.workspaceId, sourceWindowId: current.start.sourceWindowId, tabId: current.start.tabId });
      }
      setIncoming(undefined);
    };
    window.addEventListener('pointermove', updateIncoming);
    window.addEventListener('pointerup', finishIncoming);
    const cancelIncoming = (event: PointerEvent) => {
      const current = incomingRef.current;
      // A native drag crosses WebViews while the source pointer stream is
      // cancelled by WebKitGTK.  Let the HTML drop/dragend lifecycle decide
      // the outcome instead of cancelling a valid target preview early.
      if (current?.nativeDrag || current?.pointerInside) return;
      finishIncoming(event, true);
    };
    window.addEventListener('pointercancel', cancelIncoming);
    return () => {
      window.removeEventListener('pointermove', updateIncoming);
      window.removeEventListener('pointerup', finishIncoming);
      window.removeEventListener('pointercancel', cancelIncoming);
    };
  }, [incoming?.start.transactionId, shell]);

  React.useEffect(() => {
    // A pointer crossing into this native WebView may arrive before the
    // asynchronous Tauri listener has observed the start event. Discover the
    // active bounded start record directly while the pointer is over this
    // tab strip; this keeps redock deterministic across WebKitGTK windows.
    const discoverIncoming = (event: PointerEvent) => {
      if (incomingRef.current || !isInsideStrip(event.clientX, event.clientY)) return;
      const transfer = readSharedTransferStart();
      if (!validIncomingTransfer(transfer)) return;
      setIncoming({ start: transfer, targetIndex: insertionIndexAt(event.clientX), pointerInside: true });
    };
    window.addEventListener('pointermove', discoverIncoming);
    return () => window.removeEventListener('pointermove', discoverIncoming);
  }, [shell]);

  const updateNativeTransferPreview = (event: React.DragEvent<HTMLDivElement>) => {
    const transfer = nativeTransferStart(event);
    if (!validIncomingTransfer(transfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const targetIndex = insertionIndexAt(event.clientX);
    setIncoming(previous => previous?.start.transactionId === transfer.transactionId
      ? { ...previous, targetIndex, pointerInside: true, nativeDrag: true }
      : { start: transfer, targetIndex, pointerInside: true, nativeDrag: true });
    void emitDesktopWindowTransfer({ type: 'hover', transactionId: transfer.transactionId, workspaceId: transfer.workspaceId, sourceWindowId: transfer.sourceWindowId, targetWindowId: shell.windowId, tabId: transfer.tabId, targetIndex });
  };

  const dropNativeTransfer = (event: React.DragEvent<HTMLDivElement>) => {
    const currentIncoming = incomingRef.current;
    const transfer = currentIncoming && currentIncoming.nativeDrag
      ? currentIncoming.start
      : nativeTransferStart(event);
    if (!transfer) return;
    const sameWindow = transfer.sourceWindowId === shell.windowId;
    if (!sameWindow && !validIncomingTransfer(transfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const targetIndex = insertionIndexAt(event.clientX, sameWindow ? transfer.tabId : undefined);
    nativeDropRef.current = transfer.transactionId;
    if (sameWindow) {
      shell.reorderTab(transfer.tabId, targetIndex);
      void emitDesktopWindowTransfer({ type: 'cancel', transactionId: transfer.transactionId, workspaceId: transfer.workspaceId, sourceWindowId: transfer.sourceWindowId, tabId: transfer.tabId });
    } else {
      const accepted = shell.acceptWindowTransfer(transfer, targetIndex);
      void emitDesktopWindowTransfer({ type: accepted ? 'accepted' : 'rejected', transactionId: transfer.transactionId, workspaceId: transfer.workspaceId, sourceWindowId: transfer.sourceWindowId, targetWindowId: shell.windowId, tabId: transfer.tabId, targetIndex: accepted ? targetIndex : undefined, ...(accepted ? {} : { reason: 'ownership-check-failed' }) });
    }
    setIncoming(undefined);
  };

  const leaveNativeTransferPreview = (event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setIncoming(previous => previous?.nativeDrag ? { ...previous, pointerInside: false } : previous);
  };

  React.useEffect(() => {
    // WebKitGTK can retarget a native drag to the WebView's document instead
    // of the React strip node while crossing native window boundaries.  Keep
    // the node handlers for ordinary browser DnD, but also observe capture
    // phase events so a real cross-window drag always gets a visible marker
    // and an atomic drop target.
    const isStripEvent = (event: DragEvent): boolean => {
      const target = event.target;
      return isInsideStrip(event.clientX, event.clientY) || (target instanceof Node && Boolean(stripRef.current?.contains(target)));
    };
    const onDragOver = (event: DragEvent) => {
      if (isStripEvent(event)) updateNativeTransferPreview(event as unknown as React.DragEvent<HTMLDivElement>);
    };
    const onDrop = (event: DragEvent) => {
      if (isStripEvent(event)) dropNativeTransfer(event as unknown as React.DragEvent<HTMLDivElement>);
    };
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('drop', onDrop, true);
    };
  }, [shell]);

  React.useEffect(() => {
    const transactionId = drag?.transferTransactionId;
    if (!transactionId) return undefined;
    // If the pointer is released over another application, neither Keystone
    // WebView receives pointerup.  Keep the source authoritative and clear
    // the shared preview after a bounded timeout rather than losing a tab.
    const timeout = window.setTimeout(() => {
      if (dragRef.current?.transferTransactionId !== transactionId) return;
      const active = dragRef.current;
      clearPointerListeners();
      dragRef.current = undefined;
      setDrag(undefined);
      if (active) void emitDesktopWindowTransfer({ type: 'cancel', transactionId, workspaceId: shell.getSnapshot().workspace.id, sourceWindowId: shell.windowId, tabId: active.tabId });
    }, 8_000);
    return () => window.clearTimeout(timeout);
  }, [drag?.transferTransactionId, shell]);

  React.useEffect(() => {
    if (!drag?.transferTransactionId) return undefined;
    // Storage events are normally enough to refresh the source. Poll only
    // during an active cross-window drag so an accepted transfer also closes
    // a source WebView when the compositor drops an event during a boundary
    // crossing.
    const interval = window.setInterval(() => shell.refreshFromStorage(), 250);
    return () => window.clearInterval(interval);
  }, [drag?.transferTransactionId, shell]);

  const finishDrag = React.useCallback((cancelled = false) => {
    const active = dragRef.current;
    if (!active) return;
    clearPointerListeners();
    if (!cancelled) {
      const transfer = active.transferTransactionId;
      if (transfer) {
        if (isInsideStrip(active.x, active.y)) shell.reorderTab(active.tabId, active.targetIndex);
        else if (active.detachPreview && settings.values['tabs.tearOffEnabled']) void shell.openTabInNewWindow(active.tabId, { x: active.x - 420, y: active.y - 20, width: 1120, height: 720 });
        void emitDesktopWindowTransfer({ type: 'cancel', transactionId: transfer, workspaceId: shell.getSnapshot().workspace.id, sourceWindowId: shell.windowId, tabId: active.tabId });
      } else if (active.detachPreview && settings.values['tabs.tearOffEnabled']) {
        void shell.openTabInNewWindow(active.tabId, { x: active.x - 420, y: active.y - 20, width: 1120, height: 720 });
      } else {
        shell.reorderTab(active.tabId, active.targetIndex);
      }
    }
    dragRef.current = undefined;
    setDrag(undefined);
  }, [settings.values, shell]);

  function movePointer(event: PointerEvent) {
    const active = dragRef.current;
    const strip = stripRef.current;
    if (!active || !strip || event.pointerId !== active.pointerId) return;
    const bounds = strip.getBoundingClientRect();
    const currentTabs = tabsRef.current;
    const targetIndex = insertionIndexAt(event.clientX, active.tabId);
    const moved = Math.hypot(event.clientX - active.startX, event.clientY - active.startY) > 8;
    const outside = event.clientY < bounds.top - 42 || event.clientY > bounds.bottom + 42 || event.clientX < bounds.left - 64 || event.clientX > bounds.right + 64;
    const detachPreview = settings.values['tabs.tearOffEnabled'] && moved && outside && Math.hypot(event.clientX - active.startX, event.clientY - active.startY) > settings.values['tabs.detachThreshold'];
    let next: LocalDrag = { ...active, x: event.clientX, y: event.clientY, targetIndex, detachPreview, moved: active.moved || moved };
    if (moved && !active.transferTransactionId) {
      const tab = currentTabs.find(candidate => candidate.id === active.tabId);
      if (tab) {
        const transactionId = createDesktopTransferId();
        next = { ...next, transferTransactionId: transactionId };
        void emitDesktopWindowTransfer({ type: 'start', transactionId, workspaceId: shell.getSnapshot().workspace.id, sourceWindowId: shell.windowId, tabId: tab.id, sourceIndex: currentTabs.findIndex(candidate => candidate.id === tab.id), tab: cloneDesktopTransferTab(tab) });
      }
    }
    dragRef.current = next;
    setDrag(next);
  }

  const startNativeDrag = (event: React.DragEvent<HTMLDivElement>, tabId: string) => {
    const tab = tabsRef.current.find(candidate => candidate.id === tabId);
    if (!tab) { event.preventDefault(); return; }
    const existing = dragRef.current?.tabId === tabId ? dragRef.current : undefined;
    const transactionId = existing?.transferTransactionId ?? createDesktopTransferId();
    const next: LocalDrag = {
      ...(existing ?? { tabId, pointerId: -1, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, targetIndex: tabsRef.current.findIndex(candidate => candidate.id === tabId), detachPreview: false, moved: true }),
      nativeDrag: true,
      transferTransactionId: transactionId,
      moved: true,
      x: event.clientX || existing?.x || 0,
      y: event.clientY || existing?.y || 0,
    };
    nativeDropRef.current = undefined;
    dragRef.current = next;
    setDrag(next);
    clearPointerListeners();
    event.dataTransfer.effectAllowed = 'move';
    const start: DesktopWindowTransferStart = {
      type: 'start',
      transactionId,
      workspaceId: shell.getSnapshot().workspace.id,
      sourceWindowId: shell.windowId,
      tabId: tab.id,
      sourceIndex: tabsRef.current.findIndex(candidate => candidate.id === tab.id),
      tab: cloneDesktopTransferTab(tab),
    };
    try {
      // Keep the full bounded start payload in an app-private MIME type so a
      // native drag can cross WebViews even when Tauri event delivery races
      // the destination.  Plain text exposes only an opaque transaction ID.
      event.dataTransfer.setData(DESKTOP_TAB_TRANSFER_DATA, JSON.stringify(start));
      event.dataTransfer.setData('text/plain', transactionId);
    } catch {
      // The shared localStorage/Tauri channel remains authoritative.
    }
    void emitDesktopWindowTransfer(start);
  };

  const updateNativeDrag = (event: React.DragEvent<HTMLDivElement>, tabId: string) => {
    const active = dragRef.current;
    if (!active || active.tabId !== tabId) return;
    const bounds = stripRef.current?.getBoundingClientRect();
    const x = event.clientX || active.x;
    const y = event.clientY || active.y;
    const moved = active.moved || Math.hypot(x - active.startX, y - active.startY) > 8;
    const outside = Boolean(bounds && (y < bounds.top - 42 || y > bounds.bottom + 42 || x < bounds.left - 64 || x > bounds.right + 64));
    const detachPreview = settings.values['tabs.tearOffEnabled'] && moved && outside && Math.hypot(x - active.startX, y - active.startY) > settings.values['tabs.detachThreshold'];
    const next = { ...active, nativeDrag: true, x, y, moved, detachPreview };
    dragRef.current = next;
    setDrag(next);
  };

  const finishNativeDrag = (event: React.DragEvent<HTMLDivElement>, tabId: string) => {
    const active = dragRef.current;
    if (!active || active.tabId !== tabId || !active.transferTransactionId) return;
    const transactionId = active.transferTransactionId;
    const last = { ...active, x: event.clientX || active.x, y: event.clientY || active.y };
    window.setTimeout(() => {
      const current = dragRef.current;
      if (!current || current.tabId !== tabId || current.transferTransactionId !== transactionId) return;
      const shared = readSharedTransferEvent(transactionId);
      const wasDropped = nativeDropRef.current === transactionId || shared?.type === 'accepted' || shared?.type === 'committed';
      clearPointerListeners();
      dragRef.current = undefined;
      setDrag(undefined);
      if (wasDropped) return;
      if (last.detachPreview && settings.values['tabs.tearOffEnabled']) {
        void shell.openTabInNewWindow(tabId, { x: last.x - 420, y: last.y - 20, width: 1120, height: 720 });
      } else {
        void emitDesktopWindowTransfer({ type: 'cancel', transactionId, workspaceId: shell.getSnapshot().workspace.id, sourceWindowId: shell.windowId, tabId });
      }
    }, 90);
  };

  function releasePointer(event: PointerEvent) { if (dragRef.current?.pointerId === event.pointerId) finishDrag(); }
  function cancelPointer(event: PointerEvent) {
    const active = dragRef.current;
    if (active?.pointerId !== event.pointerId) return;
    // WebKitGTK cancels a pointer stream when it leaves one native WebView.
    // A started transfer must stay alive long enough for the destination
    // WebView to accept it; the bounded watchdog/storage protocol below still
    // handles a real cancellation or a release over an unrelated app.
    if (active.transferTransactionId) return;
    finishDrag(true);
  }

  const startDrag = (event: React.PointerEvent<HTMLDivElement>, tabId: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const initial: LocalDrag = { tabId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, targetIndex: tabs.findIndex(tab => tab.id === tabId), detachPreview: false, moved: false };
    dragRef.current = initial;
    setDrag(initial);
    window.addEventListener('pointermove', movePointer);
    window.addEventListener('pointerup', releasePointer, { once: false });
    window.addEventListener('pointercancel', cancelPointer, { once: false });
  };

  const otherWindows = shell.listWindows().filter(window => window.id !== shell.windowId);
  const windowLabel = (windowId: string, primary: boolean) => {
    if (primary) return t.home === 'Главная' ? 'главное окно' : 'main window';
    const index = shell.listWindows().filter(window => !window.primary).findIndex(window => window.id === windowId) + 1;
    return t.home === 'Главная' ? `окно ${Math.max(1, index)}` : `window ${Math.max(1, index)}`;
  };
  const openOverflowMenu = () => {
    const rect = overflowButtonRef.current?.getBoundingClientRect();
    if (rect) setOverflowMenu({ x: rect.left, y: rect.bottom + 4 });
  };
  const insertionMarker = incoming?.pointerInside ? incoming.targetIndex : undefined;
  return <div ref={stripRef} className={`tab-strip${drag ? ' has-drag' : ''}${drag?.detachPreview ? ' detach-preview' : ''}${incoming?.pointerInside ? ' receiving-tab' : ''}`} data-keystone-region="tab-strip" data-tab-style={settings.values['tabs.style']} data-transfer-target={incoming?.pointerInside ? 'true' : 'false'} role="tablist" aria-label={t.tabList} onDragEnter={updateNativeTransferPreview} onDragOver={updateNativeTransferPreview} onDragLeave={leaveNativeTransferPreview} onDrop={dropNativeTransfer}>
    <div className="tab-strip-leading">
      <button ref={overflowButtonRef} type="button" className="icon-button tab-overflow-button" aria-label={t.tabList} title={t.tabList} aria-expanded={Boolean(overflowMenu)} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); openOverflowMenu(); }}><Icon name="list" size={15} /></button>
    </div>
    <div className="tab-strip-scroll">
    {tabs.map((tab, index) => {
      const active = drag?.tabId === tab.id;
      const sourceIndex = drag ? tabs.findIndex(candidate => candidate.id === drag.tabId) : -1;
      const shiftWidth = (tabRefs.current.get(tab.id)?.getBoundingClientRect().width ?? 140) + 6;
      const shift = drag && !active && !drag.detachPreview && !drag.transferTransactionId
        ? drag.targetIndex > sourceIndex && index > sourceIndex && index <= drag.targetIndex ? -shiftWidth
          : drag.targetIndex < sourceIndex && index >= drag.targetIndex && index < sourceIndex ? shiftWidth
            : 0
        : 0;
      return <React.Fragment key={tab.id}>
        {((drag && !drag.detachPreview && !drag.transferTransactionId && index === drag.targetIndex) || (incoming && insertionMarker === index)) && <span className="tab-insertion-marker" aria-hidden />}
        <div ref={node => { if (node) tabRefs.current.set(tab.id, node); else tabRefs.current.delete(tab.id); }} className={`tab${currentTab?.id === tab.id ? ' active' : ''}${tab.pinned ? ' pinned' : ''}${tab.dirty ? ' dirty' : ''}${tab.locked ? ' locked' : ''}${active ? ' dragging' : ''}`} data-keystone-component="tab" tabIndex={0} role="tab" aria-selected={currentTab?.id === tab.id} draggable onDragStart={event => startNativeDrag(event, tab.id)} onDrag={event => updateNativeDrag(event, tab.id)} onDragEnd={event => finishNativeDrag(event, tab.id)} style={{ transform: shift ? `translateX(${shift}px)` : undefined }} onPointerDown={event => startDrag(event, tab.id)} onDoubleClick={() => { const action = settings.values['tabs.doubleClickAction']; if (action === 'close') shell.closeTab(tab.id); else if (action === 'new-tab') shell.openReference({ kind: 'home', id: 'new-tab', label: t.home }, { allowDuplicate: true }); }} onContextMenu={event => { event.preventDefault(); setMenu({ tabId: tab.id, x: event.clientX, y: event.clientY }); }} onAuxClick={event => { if (event.button === 1 && settings.values['tabs.middleClickClose']) { event.preventDefault(); shell.closeTab(tab.id); } }} onClick={() => shell.focusTab(tab.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); shell.focusTab(tab.id); } else if (event.key === 'ArrowLeft') { event.preventDefault(); shell.nextTab(-1); } else if (event.key === 'ArrowRight') { event.preventDefault(); shell.nextTab(1); } else if (event.key === 'Delete') { event.preventDefault(); shell.closeTab(tab.id); } }}>
          {settings.values['tabs.showIcons'] && <span className="tab-kind">{tabIcon(tab.kind)}</span>}<span className="tab-title">{tabTitle(tab, t)}</span>{tab.locked && <span className="tab-lock"><Icon name="lock" size={12} /></span>}{tab.dirty && <span className="tab-dirty"><Icon name="circle" size={6} /></span>}{settings.values['tabs.closeButtons'] !== 'active' || currentTab?.id === tab.id ? <IconButton className="tab-menu-button" icon="close" size={13} draggable={false} onClick={event => { event.stopPropagation(); shell.closeTab(tab.id); }} label={`${t.close}: ${tabTitle(tab, t)}`} /> : null}
        </div>
      </React.Fragment>;
    })}
    {((drag && !drag.detachPreview && !drag.transferTransactionId && drag.targetIndex >= tabs.length) || (incoming && insertionMarker !== undefined && insertionMarker >= tabs.length)) && <span className="tab-insertion-marker" aria-hidden />}
    </div>
    <div className="tab-strip-actions"><IconButton className="tab-add" icon="plus" size={15} onClick={() => shell.openReference({ kind: 'home', id: 'new-tab', label: t.home }, { allowDuplicate: true })} label={t.open} /><IconButton className="tab-action" icon="undo" size={14} onClick={() => shell.reopenClosedTab()} label={t.restore} /><IconButton className="tab-action" icon="pin" size={14} onClick={() => shell.pinTab()} label={currentTab?.pinned ? t.unpin : t.pin} /></div>
    {drag && <div className={`tab-drag-proxy${drag.detachPreview ? ' detach' : ''}`} style={{ left: drag.x + 14, top: drag.y + 12 }}><span>{tabIcon(tabs.find(tab => tab.id === drag.tabId)?.kind ?? 'unknown')}</span><strong>{tabs.find(tab => tab.id === drag.tabId)?.title}</strong><small>{drag.detachPreview ? (t.home === 'Главная' ? 'Отпустите, чтобы открыть окно' : 'Release to open a window') : (t.home === 'Главная' ? 'Перетащите в другую вкладку' : 'Drag to reorder or move')}</small></div>}
    {menu ? <div className="tab-context-menu" style={{ top: menu.y, left: menu.x }} onPointerDown={event => event.stopPropagation()}>
      <button type="button" onClick={() => { shell.focusTab(menu.tabId); setMenu(undefined); }}><Icon name="arrow-right" size={14} />{t.open}</button>
      <button type="button" onClick={() => { shell.duplicateTab(menu.tabId); setMenu(undefined); }}><Icon name="copy" size={14} />{t.openInTab}</button>
      <button type="button" onClick={() => { void shell.openTabInNewWindow(menu.tabId); setMenu(undefined); }}><Icon name="external-link" size={14} />{t.openInNewWindow}</button>
      {otherWindows.length > 0 && <span className="tab-context-label">{t.moveTabTo}</span>}
      {otherWindows.map(window => <button type="button" key={window.id} onClick={() => { shell.transferTabToWindow(menu.tabId, window.id); setMenu(undefined); }}><Icon name="arrow-right" size={14} />{windowLabel(window.id, window.primary)}</button>)}
      {!shell.isPrimaryWindow && otherWindows.length > 0 && <span className="tab-context-label">{t.mergeWindowInto}</span>}
      {!shell.isPrimaryWindow && otherWindows.map(window => <button type="button" key={`merge-${window.id}`} onClick={() => { shell.mergeWindowInto(window.id); setMenu(undefined); }}><Icon name="folder" size={14} />{windowLabel(window.id, window.primary)}</button>)}
      <button type="button" onClick={() => { shell.closeTab(menu.tabId); setMenu(undefined); }}><Icon name="close" size={14} />{t.close}</button>
      <button type="button" onClick={() => { shell.closeOtherTabs(menu.tabId); setMenu(undefined); }}>{t.closeOtherTabs}</button>
      <button type="button" onClick={() => { shell.pinTab(menu.tabId); setMenu(undefined); }}><Icon name="pin" size={14} />{tabs.find(tab => tab.id === menu.tabId)?.pinned ? t.unpin : t.pin}</button>
      <button type="button" onClick={() => { const tab = tabs.find(candidate => candidate.id === menu.tabId); if (tab) void copyLink(tab); setMenu(undefined); }}><Icon name="link" size={14} />{t.shareLink}</button>
    </div> : null}
    {overflowMenu ? <div className="tab-overflow-menu" style={{ top: overflowMenu.y, left: overflowMenu.x }} onPointerDown={event => event.stopPropagation()} role="menu">
      <strong>{t.home === 'Главная' ? `${tabs.length} вкладок` : `${tabs.length} tabs`}</strong>
      {tabs.map(tab => <button key={tab.id} type="button" role="menuitem" className={currentTab?.id === tab.id ? 'active' : undefined} onClick={() => { shell.focusTab(tab.id); setOverflowMenu(undefined); }}><span>{settings.values['tabs.showIcons'] && <Icon name={(tab.kind === 'tasks' ? 'task' : tab.kind === 'document' ? 'document' : tab.kind === 'settings' ? 'settings' : 'folder') as IconName} size={15} />}<strong>{tabTitle(tab, t)}</strong>{tab.pinned && <small>{t.home === 'Главная' ? 'Закреплена' : 'Pinned'}</small>}</span>{currentTab?.id === tab.id && <Icon name="check" size={15} />}</button>)}
    </div> : null}
  </div>;
}

function PaneTree({ node, shell, t, contextRegistry, onDragRef, settings, settingsStore, settingsContext, onSettingChange }: { node: PaneNode; shell: DesktopShellController; t: Copy; contextRegistry: ContextProviderRegistry; onDragRef: (ref?: KeystoneObjectReference) => void; settings: DesktopSettingsSnapshot; settingsStore: DesktopSettingsStore; settingsContext: DesktopSettingsContext; onSettingChange: (id: DesktopSettingId, value: unknown, scope?: DesktopSettingScope) => void }) {
  if (node.type === 'leaf') return <PaneView node={node} shell={shell} t={t} contextRegistry={contextRegistry} onDragRef={onDragRef} settings={settings} settingsStore={settingsStore} settingsContext={settingsContext} onSettingChange={onSettingChange} />;
  return <div className={`pane-split ${node.orientation}`} style={{ ['--split-ratio' as string]: node.ratio }}><div className="pane-child"><PaneTree node={node.first} shell={shell} t={t} contextRegistry={contextRegistry} onDragRef={onDragRef} settings={settings} settingsStore={settingsStore} settingsContext={settingsContext} onSettingChange={onSettingChange} /></div><SplitDivider node={node} shell={shell} /><div className="pane-child"><PaneTree node={node.second} shell={shell} t={t} contextRegistry={contextRegistry} onDragRef={onDragRef} settings={settings} settingsStore={settingsStore} settingsContext={settingsContext} onSettingChange={onSettingChange} /></div></div>;
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

function PaneView({ node, shell, t, contextRegistry, onDragRef, settings, settingsStore, settingsContext, onSettingChange }: { node: Extract<PaneNode, { type: 'leaf' }>; shell: DesktopShellController; t: Copy; contextRegistry: ContextProviderRegistry; onDragRef: (ref?: KeystoneObjectReference) => void; settings: DesktopSettingsSnapshot; settingsStore: DesktopSettingsStore; settingsContext: DesktopSettingsContext; onSettingChange: (id: DesktopSettingId, value: unknown, scope?: DesktopSettingScope) => void }) {
  const tabs = node.tabIds.flatMap(tabId => { const tab = shell.tabs.get(tabId); return tab ? [tab] : []; });
  const active = node.activeTabId ? shell.tabs.get(node.activeTabId) : tabs[0];
  const showPaneToolbar = shell.getSnapshot().workspace.paneTree.type === 'split';
  return <section className={`pane-view${shell.currentPaneId === node.id ? ' focused' : ''}`} role="region" tabIndex={0} aria-label={active?.title ?? t.workspace} onClick={() => shell.focusPane(node.id)} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); shell.focusPane(node.id); } }} onDragOver={event => event.preventDefault()} onDrop={event => handleDrop(event, shell, undefined, node.id)}>
    {showPaneToolbar && <div className="pane-toolbar"><div className="pane-context-title">{active ? <>{tabIcon(active.kind)} <span>{active.title}</span></> : <span>{t.empty}</span>}</div><div className="pane-actions"><button type="button" onClick={event => { event.stopPropagation(); shell.splitPane('horizontal', node.id); }} title={t.splitHorizontal} aria-label={t.splitHorizontal}><Icon name="panel-right" size={14} /></button><button type="button" onClick={event => { event.stopPropagation(); shell.splitPane('vertical', node.id); }} title={t.splitVertical} aria-label={t.splitVertical}><Icon name="panel-left" size={14} /></button><button type="button" onClick={event => { event.stopPropagation(); shell.closePane(node.id); }} title={t.close} aria-label={t.close}><Icon name="close" size={14} /></button></div></div>}
    <div className="pane-content">{active ? <TabSurface tab={active} shell={shell} t={t} contextRegistry={contextRegistry} onDragRef={onDragRef} settings={settings} settingsStore={settingsStore} settingsContext={settingsContext} onSettingChange={onSettingChange} /> : <EmptyPane t={t} shell={shell} />}</div>
  </section>;
}

function TabSurface({ tab, shell, t, contextRegistry, onDragRef, settings, settingsStore, settingsContext, onSettingChange }: { tab: DesktopTab; shell: DesktopShellController; t: Copy; contextRegistry: ContextProviderRegistry; onDragRef: (ref?: KeystoneObjectReference) => void; settings: DesktopSettingsSnapshot; settingsStore: DesktopSettingsStore; settingsContext: DesktopSettingsContext; onSettingChange: (id: DesktopSettingId, value: unknown, scope?: DesktopSettingScope) => void }) {
  const ref = tab.object;
  const dragRef = ref ? { onDragStart: (event: React.DragEvent) => { event.dataTransfer.setData('application/x-keystone-ref', JSON.stringify(ref)); onDragRef(ref); } } : undefined;
  if (tab.locked) return <div className="locked-surface"><span className="locked-icon"><Icon name="lock" size={28} /></span><h2>{t.locked}</h2><p>{t.privacy}</p><button className="secondary-button" onClick={() => shell.closeTab(tab.id, true)}>{t.close}</button></div>;
  if (tab.kind === 'home') return <HomeSurface shell={shell} t={t} settings={settings} onSettingChange={onSettingChange} />;
  if (tab.kind === 'music') return <MusicSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'video') return <VideoSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'shorts') return <ShortsSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'ai') return <AISurface shell={shell} t={t} />;
  if (tab.kind === 'network') return <ConnectivitySurface t={t} />;
  if (tab.kind === 'inbox') return <InboxSurface t={t} />;
  if (tab.kind === 'capture') return <CaptureSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'agent') return <AgentSurface shell={shell} t={t} />;
  if (tab.kind === 'browser') return <BrowserSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'subscriptions') return <SubscriptionsSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'web-library') return <WebLibrarySurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'workboard') return <WorkboardSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'tasks') return <TasksSurface key={tab.id} tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'contacts') return <ContactsSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'space' && tab.object?.id === 'collaboration') return <CollaborationSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'settings') return tab.object?.id === 'search' ? <SearchSurface tab={tab} shell={shell} t={t} /> : tab.object?.id === 'device' ? <DeviceSurface t={t} /> : tab.object?.id === 'skills' ? <SkillsSurface shell={shell} t={t} /> : tab.object?.id === 'plugins' ? <PluginsSurface t={t} /> : tab.object?.id === 'continuity' ? <ContinuitySurface shell={shell} t={t} /> : tab.object?.id === 'nearby' ? <NearbyExchangeSurface shell={shell} t={t} /> : <SettingsSurface shell={shell} t={t} settings={settings} settingsStore={settingsStore} settingsContext={settingsContext} onSettingChange={onSettingChange} initialCategory={tab.object?.id === 'customize' ? 'appearance' : tab.object?.query} />;
  if (tab.kind === 'vault') return <VaultSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'graph') return <VaultGraphSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'canvas') return <VaultCanvasSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'calendar') return <CalendarSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'map') return <MapsSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'mail') return <MailSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'file') return <FilesSurface key={tab.id} tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'document') return <DocumentsSurface key={tab.id} tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'publication') return <PublicationSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'media' && tab.object?.id === 'calls') return <CallsSurface t={t} />;
  if (tab.kind === 'media') return <PhotosSurface tab={tab} shell={shell} t={t} />;
  return <div className="object-surface" draggable={Boolean(ref)} {...dragRef}>
    <div className="surface-kicker"><span className="surface-icon">{tabIcon(tab.kind)}</span><span>{tab.kind}</span><span className="surface-badge">{t.local}</span></div>
    <h1>{tab.title}</h1>
    <p className="surface-description">{descriptionFor(tab, t)}</p>
    {ref && <div className="object-id"><span>{t.objectId}</span><code>{ref.id}</code></div>}
    <div className="surface-grid"><button className="surface-card" onClick={() => shell.toggleAgentPanel(true)}><span><Icon name="bot" size={18} /></span><strong>{t.askAbout}</strong><small>{t.agentHint}</small></button><button className="surface-card" onClick={() => shell.setNotice(`${t.references}: ${tab.title}`)}><span><Icon name="link" size={18} /></span><strong>{t.references}</strong><small>{t.related}</small></button></div>
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
  const [preview, setPreview] = React.useState<{ readonly name: string; readonly mimeType: string; readonly text?: string; readonly size: number }>();
  const requestedId = tab.object?.id;
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
    ]).then(([nextPage, nextConflicts]) => { if (active) { setPage(nextPage); setConflicts(nextConflicts); } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
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
  const importFile = async (input: { readonly filename: string; readonly mimeType: string; readonly bytes: Uint8Array }) => {
    if (!runtime?.importFile || !selectedFolderId) return;
    await run(async () => { await runtime.importFile!({ ...input, folderId: selectedFolderId as DesktopFileFolder['id'] }); });
  };
  const pickFile = async () => {
    try {
      const file = await pickDesktopFile('file');
      if (file) await importFile({ filename: file.name, mimeType: file.mimeType, bytes: file.bytes });
    } catch (reason) {
      setError(errorText(reason, ru ? 'Не удалось выбрать файл.' : 'Could not pick a file.'));
    }
  };
  const openFile = React.useCallback(async (file: DesktopFileProjection) => {
    if (!runtime?.readFile) return;
    const bytes = await runtime.readFile(file.fileId);
    const text = file.revision.mimeType.startsWith('text/') || file.revision.mimeType === 'application/json' ? new TextDecoder().decode(bytes) : undefined;
    return { name: file.entry.name, mimeType: file.revision.mimeType, size: bytes.byteLength, text };
  }, [runtime]);
  const showFile = async (file: DesktopFileProjection) => {
    setError('');
    try { setPreview(await openFile(file)); }
    catch (reason) { setError(errorText(reason, ru ? 'Не удалось открыть файл.' : 'Could not open the file.')); }
  };
  React.useEffect(() => {
    if (!runtime?.describeFile || !requestedId?.startsWith('file:')) return undefined;
    let active = true;
    void runtime.describeFile(requestedId as DesktopFileProjection['fileId']).then(async file => {
      const value = await openFile(file);
      if (!active) return;
      setSelectedFolderId(file.entry.parentFolderId);
      setPreview(value);
    }).catch(reason => {
      if (active) setError(errorText(reason, ru ? 'Не удалось открыть файл.' : 'Could not open the file.'));
    });
    return () => { active = false; };
  }, [requestedId, openFile, ru, runtime]);
  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    await importFile({ filename: file.name, mimeType: file.type || 'application/octet-stream', bytes: new Uint8Array(await file.arrayBuffer()) });
  };
  const selectedFolder = folders.find(folder => folder.id === selectedFolderId);
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="files" size={15} /></span><span>{t.files}</span><span className="surface-badge">{ru ? 'НЕ ПОДКЛЮЧЕНО' : 'NOT CONNECTED'}</span></div><h1>{t.files}</h1><p className="surface-description">{ru ? 'Файлы пока недоступны на этом устройстве.' : 'Files are not available on this device yet.'}</p><div className="adapter-note"><span><Icon name="folder" size={16} /></span><div><strong>{ru ? 'Подключите локальную папку' : 'Connect a local folder'}</strong><small>{ru ? 'Выберите папку в настройках, чтобы работать с файлами на устройстве.' : 'Choose a folder in Settings to work with files on this device.'}</small></div></div></div>;

  return <div className="object-surface" onDragOver={event => event.preventDefault()} onDrop={event => void onDrop(event)}>
    <div className="surface-kicker"><span className="surface-icon"><Icon name="files" size={15} /></span><span>{t.files}</span><span className="surface-badge">{t.local}</span></div>
    <div className="web-library-heading"><div><h1>{t.files}</h1><p className="surface-description">{ru ? 'Общие папки и версии файлов, доступные по запросу.' : 'Shared folders and file versions, available when you request them.'}</p></div><div className="web-library-actions"><button className="secondary-button" onClick={() => setVersion(value => value + 1)}>{t.refresh}</button>{runtime.importFile ? <button className="primary-button" disabled={!selectedFolderId} onClick={() => void pickFile()}>{ru ? 'Импортировать файл' : 'Import file'}</button> : null}<button className="primary-button" onClick={() => void createFolder()}>＋ {ru ? 'Папка' : 'Folder'}</button></div></div>
    <div className="web-library-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={ru ? 'Искать по именам файлов и папок…' : 'Search file and folder names…'} aria-label={ru ? 'Поиск файлов' : 'File search'} /><span>{ru ? `${folders.length} папок` : `${folders.length} folders`}</span></div>
    {error ? <span className="maps-notice" role="status">{error}</span> : null}
    {query.trim() ? <div className="web-library-layout"><div className="web-library-list"><span className="section-label">{ru ? 'Результаты поиска' : 'Search results'}</span>{searchResults.length ? searchResults.map(result => <button key={result.entry.id} className="web-library-entry" onClick={() => {
      const id = result.entry.fileId ?? result.entry.childFolderId;
      if (id) shell.openReference({ kind: 'file', id, label: result.entry.name });
    }}><strong>{result.entry.name}</strong><small>{result.folder.name} · {Math.round(result.score * 100)}%</small></button>) : <div className="web-library-empty">{ru ? 'Совпадений нет.' : 'No matches.'}</div>}</div><div className="web-library-reader"><div className="web-library-reader-empty"><div><span>⌕</span><p>{ru ? 'Выберите папку, чтобы открыть локальный список.' : 'Choose a folder to open its local listing.'}</p></div></div></div></div> : folders.length ? <div className="web-library-layout"><div className="web-library-list"><span className="section-label">{ru ? 'Папки' : 'Folders'}</span>{folders.map(folder => <button key={folder.id} className={`web-library-entry${folder.id === selectedFolderId ? ' active' : ''}`} onClick={() => setSelectedFolderId(folder.id)}><strong>{folder.name}</strong><small>{folder.scope}</small></button>)}<div className="adapter-note"><span><Icon name="folder" size={16} /></span><div><strong>{ru ? 'Папка на устройстве' : 'Device folder'}</strong><small>{ru ? 'Файлы подключаются только после явного выбора владельца.' : 'Files are connected only after the owner explicitly chooses a folder.'}</small></div></div></div><div className="web-library-reader">{selectedFolder ? <><div className="web-library-reader-heading"><div><h2>{selectedFolder.name}</h2><p>{selectedFolder.scope} · {selectedFolder.revision} {ru ? 'последняя версия' : 'latest version'}</p></div>{runtime.filesystemStatus?.(selectedFolder.id) ? <span className="surface-badge">{runtime.filesystemStatus(selectedFolder.id)?.state}</span> : null}</div><div className="web-library-entry-list">{page?.items.length ? page.items.map(file => <div key={file.fileId} className="surface-card"><strong>{file.entry.name}</strong><small>{file.revision.mimeType} · {formatBytes(file.revision.size)} · {file.revisionCount} {ru ? 'версий' : 'revisions'}</small><small>{ru ? 'Доступность' : 'Availability'}: {file.availability}</small><div className="web-library-actions">{runtime.readFile ? <button className="secondary-button" onClick={() => void showFile(file)}>{ru ? 'Открыть' : 'Open'}</button> : null}{runtime.keepOnDevice ? <button className="secondary-button" onClick={() => void run(() => runtime.keepOnDevice!(selectedFolder.id, file.fileId))}>{ru ? 'Хранить на устройстве' : 'Keep on device'}</button> : null}{runtime.trash ? <button className="secondary-button" onClick={() => void run(() => runtime.trash!(file.entry.id, true))}>{ru ? 'В корзину' : 'Move to trash'}</button> : null}</div></div>) : <div className="web-library-empty">{ru ? 'Файлов в этой папке нет.' : 'No files in this folder.'}</div>}</div>{preview ? <div className="file-preview"><div><strong>{preview.name}</strong><small>{preview.mimeType} · {formatBytes(preview.size)}</small></div>{preview.text !== undefined ? <pre>{preview.text.slice(0, 200_000)}</pre> : <p>{ru ? 'Файл импортирован и доступен локально; встроенный просмотр для этого MIME ещё не подключён.' : 'The file is imported and available locally; an inline preview for this MIME is not connected yet.'}</p>}</div> : null}{page && page.total > page.items.length ? <p className="web-library-notice">{ru ? `Показана первая страница из ${page.total} записей.` : `Showing the first page of ${page.total} entries.`}</p> : null}{conflicts.length ? <div className="adapter-note"><span>!</span><div><strong>{ru ? `Открытых конфликтов: ${conflicts.length}` : `${conflicts.length} open conflicts`}</strong><small>{conflicts.slice(0, 3).map(conflict => `${conflict.kind}: ${conflict.details}`).join(' · ')}</small></div></div> : null}</> : <div className="web-library-reader-empty"><div><span>▣</span><p>{ru ? 'Создайте или выберите папку.' : 'Create or choose a folder.'}</p></div></div>}</div></div> : <div className="file-empty-state"><Icon name="folder" size={22} /><strong>{ru ? 'Папок пока нет' : 'No folders yet'}</strong><p>{ru ? 'Создайте папку на устройстве, чтобы импортировать и просматривать файлы.' : 'Create a device folder to import and browse files.'}</p></div>}
    <TypedReferenceDock tab={tab} shell={shell} t={t} />
  </div>;
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
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="mail" size={15} /></span><span>{t.inbox}</span><span className="surface-badge">{ru ? 'НЕ ПОДКЛЮЧЕНО' : 'NOT CONNECTED'}</span></div><h1>{t.inbox}</h1><p className="surface-description">{ru ? 'Входящие пока недоступны на этом устройстве.' : 'Inbox is not available on this device yet.'}</p></div>;
  return <div className="object-surface inbox-surface">
    <div className="surface-kicker"><span className="surface-icon"><Icon name="mail" size={15} /></span><span>{t.inbox}</span><span className="surface-badge">LOCAL PROJECTION</span></div>
    <div className="surface-heading"><div><h1>{t.inbox}</h1><p className="surface-description">{ru ? 'Единая локальная проекция: внешние источники остаются первичными, организация — на этом устройстве.' : 'One local projection: source systems remain authoritative, organization stays on this device.'}</p></div><span className="surface-badge">{result?.unreadCount ?? 0} {ru ? 'непрочитано' : 'unread'}</span></div>
    <div className="surface-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void refresh(); }} placeholder={ru ? 'Поиск по локальной проекции' : 'Search local projection'} aria-label={ru ? 'Поиск входящих' : 'Search Inbox'} /><button className="secondary-button" onClick={() => void refresh()}>{ru ? 'Обновить' : 'Refresh'}</button>{(['ALL', 'UNREAD', 'NEEDS_ACTION', 'SNOOZED', 'ARCHIVE'] as const).map(value => <button key={value} className={view === value ? 'primary-button' : 'secondary-button'} onClick={() => setView(value)}>{value === 'ALL' ? (ru ? 'Все' : 'All') : value === 'UNREAD' ? (ru ? 'Непрочитанные' : 'Unread') : value === 'NEEDS_ACTION' ? (ru ? 'Нужно действие' : 'Needs action') : value === 'SNOOZED' ? (ru ? 'Отложенные' : 'Snoozed') : (ru ? 'Архив' : 'Archive')}</button>)}</div>
    {error ? <p className="surface-error">{error}</p> : null}
    <div className="surface-grid inbox-grid">{result?.items.length ? result.items.map(item => <article className={`surface-card inbox-card${item.organization.read ? '' : ' unread'}`} key={item.id}><div className="inbox-card-heading"><span className="surface-badge">{item.presentation.badge.label}</span><time>{new Date(item.presentation.receivedAt).toLocaleString()}</time></div><h2>{item.presentation.title}</h2>{item.presentation.sender ? <small>{item.presentation.sender}</small> : null}{item.presentation.snippet ? <p>{item.presentation.snippet}</p> : null}<small>{item.presentation.reasons.join(' · ')}</small><div className="surface-actions"><button className="secondary-button" onClick={() => void local('read', item)}>{item.organization.read ? (ru ? 'Непрочитано' : 'Unread') : (ru ? 'Прочитано' : 'Read')}</button><button className="secondary-button" onClick={() => void local(item.organization.archived ? 'restore' : 'archive', item)}>{item.organization.archived ? (ru ? 'Восстановить' : 'Restore') : (ru ? 'Архив' : 'Archive')}</button><button className="secondary-button" onClick={() => void local('pin', item)}>{item.organization.pinned ? '★' : '☆'}</button>{item.actions.map(action => <button key={action.id} className={action.requiresOwnerConfirmation ? 'primary-button' : 'secondary-button'} onClick={() => void (action.kind === 'OPEN_SOURCE' ? runtime.inbox.openSource(item.id).then(() => undefined).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))) : runSourceAction(item, action))}>{action.label}</button>)}</div></article>) : <div className="surface-card"><p>{ru ? 'Входящие пока пусты.' : 'Inbox is empty.'}</p></div>}</div>
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
  const labels = ru ? { subtitle: 'Личная медиатека · оригиналы остаются на устройстве', unavailable: 'Медиатека пока недоступна', boundary: 'Импортируйте файлы явно. Keystone не читает папки и не загружает фотоплёнку автоматически.', timeline: 'Лента', albums: 'Альбомы', favorites: 'Избранное', search: 'Поиск', import: 'Импортировать выбранное', file: 'Выбрать файл', folder: 'Выбрать папку', camera: 'Выбрать фотоплёнку', trash: 'Корзина', empty: 'Медиа пока нет', viewer: 'Просмотр', metadata: 'Метаданные', share: 'Поделиться явно', device: 'На устройство', map: 'Карта координат', restore: 'Восстановить', remove: 'В корзину', local: 'Только локально', selected: 'Выбрано', noLocation: 'Координаты не извлечены', locationWarning: 'Перед отправкой координаты требуют отдельного решения владельца.', imported: 'Импорт завершён', noAlbums: 'Альбомов нет', refresh: 'Обновить' } : { subtitle: 'Private photo library · originals stay on this device', unavailable: 'Photo library is not available yet', boundary: 'Import files explicitly. Keystone does not scan folders or upload the Camera Roll automatically.', timeline: 'Timeline', albums: 'Albums', favorites: 'Favorites', search: 'Search', import: 'Import selected', file: 'Choose file', folder: 'Choose folder', camera: 'Choose Camera Roll', trash: 'Trash', empty: 'No media yet', viewer: 'Viewer', metadata: 'Metadata', share: 'Share explicitly', device: 'Send to device', map: 'GPS map', restore: 'Restore', remove: 'Move to trash', local: 'Local only', selected: 'Selected', noLocation: 'No embedded GPS', locationWarning: 'Embedded GPS needs a separate owner decision before sharing.', imported: 'Import complete', noAlbums: 'No albums', refresh: 'Refresh' };

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

  if (!runtime) return <div className="object-surface photos-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="image" size={15} /></span><span>{t.photos}</span><span className="surface-badge">{ru ? 'НЕ ПОДКЛЮЧЕНО' : 'NOT CONNECTED'}</span></div><h1>{t.photos}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{ru ? 'Медиатека пока недоступна' : 'Media library is not available yet'}</strong><small>{labels.boundary}</small></div></div></div>;
  const items = timeline?.items ?? [];
  return <div className="object-surface photos-surface" data-photos-tab={tab.object?.id ?? tab.id}>
    <div className="surface-kicker"><span className="surface-icon"><Icon name="image" size={15} /></span><span>{t.photos}</span><span className="surface-badge">{labels.local}</span></div>
    <div className="surface-heading"><div><h1>{tab.title === 'Media' || tab.title === 'Медиа' ? t.photos : tab.title}</h1><p className="surface-description">{labels.subtitle}</p></div><button className="secondary-button" onClick={() => void refresh()}>{labels.refresh}</button></div>
    <div className="surface-grid"><div className="surface-card"><strong>{labels.timeline}</strong><small>{state?.total ?? 0} · {state?.favorites ?? 0} {labels.favorites}</small></div><div className="surface-card"><strong>{labels.albums}</strong><small>{state?.albums ?? albums.length}</small></div><div className="surface-card"><strong>{labels.trash}</strong><small>{state?.trashed ?? 0}</small></div><div className="surface-card"><strong>{labels.local}</strong><small>{state?.cameraRoll.replace(/_/g, ' ')}</small></div></div>
    <div className="surface-grid"><button className={mode === 'TIMELINE' ? 'primary-button' : 'secondary-button'} onClick={() => { setMode('TIMELINE'); void refresh(); }}>{labels.timeline}</button><button className={mode === 'ALBUMS' ? 'primary-button' : 'secondary-button'} onClick={() => setMode('ALBUMS')}>{labels.albums}</button><button className={mode === 'TRASH' ? 'primary-button' : 'secondary-button'} onClick={() => setMode('TRASH')}>{labels.trash}</button><button className="secondary-button" onClick={() => void importSelected('SELECTED_FILE')}>{labels.file}</button><button className="secondary-button" onClick={() => void importSelected('SELECTED_FOLDER')}>{labels.folder}</button><button className="secondary-button" onClick={() => void importSelected('CAMERA_ROLL')}>{labels.camera}</button><button className="secondary-button" onClick={() => void map()}>{labels.map}</button></div>
    <form className="maps-search" onSubmit={search}><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/><button className="primary-button" disabled={!query.trim()}>{labels.search}</button></form>
    {mode === 'ALBUMS' ? <div className="surface-grid">{albums.length ? albums.map(album => <button className="surface-card" key={album.id} onClick={() => void runtime.album(album.id).then(values => { setTimeline({ items: values, total: values.length, groups: [] }); setMode('TIMELINE'); }).catch(() => setNotice(labels.boundary))}><strong>{album.name}</strong><small>{album.count} · {album.sharing}</small></button>) : <div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{labels.noAlbums}</strong><small>{labels.boundary}</small></div></div>}</div> : <div className="surface-grid">{items.length ? items.map(asset => <button className={`surface-card${selected?.mediaId === asset.mediaId ? ' active' : ''}`} key={asset.mediaId} onClick={() => void select(asset)}><strong>{asset.kind === 'VIDEO' ? '▶' : '▧'} {asset.filename}</strong><small>{asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}{asset.capturedAt ?? labels.local}{asset.hasEmbeddedLocation ? ' · GPS' : ''}</small><small>{asset.tags.join(' · ') || labels.noLocation}</small></button>) : <div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{labels.empty}</strong><small>{labels.boundary}</small></div></div>}</div>}
    {selected && <div className="surface-grid"><div className="surface-card"><strong>{labels.selected}: {selected.filename}</strong><small>{viewer?.metadata ? Object.entries(viewer.metadata).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${value}`).join(' · ') : labels.metadata}</small><small>{viewer?.original ?? '—'} · {viewer?.thumbnail ?? '—'}</small></div><button className="primary-button" onClick={() => void share()}>{labels.share}</button><button className="secondary-button" onClick={() => setNotice(labels.device)}>{labels.device}</button><button className="secondary-button" onClick={() => void changeTrash()}>{mode === 'TRASH' ? labels.restore : labels.remove}</button></div>}
    {notice && <small className="maps-notice">{notice}</small>}
  </div>;
}

function CallsSurface({ t }: { t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopCallsRuntime | undefined>(getDesktopCallsRuntime);
  const [, redraw] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => subscribeDesktopCallsRuntime(() => setRuntime(getDesktopCallsRuntime())), []);
  React.useEffect(() => runtime?.calls.subscribe(() => redraw()), [runtime]);
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="phone" size={15} /></span><span>{t.calls}</span><span className="surface-badge">{t.home === 'Главная' ? 'НЕ ПОДКЛЮЧЕНО' : 'NOT CONNECTED'}</span></div><h1>{t.calls}</h1><p className="surface-description">{t.localeUnavailable}</p><div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{t.calls}</strong><small>{t.callBoundary}</small></div></div></div>;
  const active = runtime.calls.current()[0];
  const history = runtime.calls.history().slice().reverse().slice(0, 20);
  return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="phone" size={15} /></span><span>{t.calls}</span><span className="surface-badge">{t.local}</span></div><h1>{t.calls}</h1>{active ? <div className="surface-card"><strong>{active.peerId}</strong><small>{active.mode} · {active.state} · {runtime.localMediaAvailable ? t.callMediaReady : t.callMediaUnavailable}</small><div className="surface-grid">{active.state === 'RINGING' ? <><button className="surface-card" onClick={() => void runtime.calls.accept(active.callId)}>{t.acceptCall}</button><button className="surface-card" onClick={() => void runtime.calls.reject(active.callId)}>{t.rejectCall}</button></> : <><button className="surface-card" onClick={() => void runtime.calls.setMuted(active.callId, active.localMicrophone === 'enabled')}>{active.localMicrophone === 'enabled' ? t.unmute : t.mute}</button><button className="surface-card" onClick={() => void runtime.calls.setCamera(active.callId, active.localCamera !== 'enabled')}>{active.localCamera === 'enabled' ? t.cameraOff : t.cameraOn}</button><button className="surface-card" onClick={() => void (active.localScreen === 'enabled' ? runtime.calls.stopScreenShare(active.callId) : runtime.calls.startScreenShare(active.callId))}>{active.localScreen === 'enabled' ? t.screenOff : t.screenOn}</button><button className="surface-card" onClick={() => void runtime.calls.hangup(active.callId)}>{t.endCall}</button></>}</div></div> : <p className="surface-description">{t.noActiveCall}</p>}{history.length > 0 && <><span className="section-label">{t.callHistory}</span>{history.map(entry => <div className="object-id" key={entry.sessionId}><span>{entry.participant} · {entry.mode}</span><code>{entry.outcome}</code></div>)}</>}</div>;
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
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="edit" size={15} /></span><span>{t.publication}</span><span className="surface-badge">{t.home === 'Главная' ? 'НЕ ПОДКЛЮЧЕНО' : 'NOT CONNECTED'}</span></div><h1>{tab.title}</h1><p className="surface-description">{t.publicationAdapter}</p><div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{t.publication}</strong><small>{t.publicationAdapter}</small></div></div></div>;
  const current = state;
  return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="edit" size={15} /></span><span>{t.publication}</span><span className="surface-badge">{current?.status ?? 'DRAFT'}</span></div><h1>{current?.title ?? tab.title}</h1><p className="surface-description">{t.publicationDisclosure}</p><div className="surface-grid"><div className="surface-card"><strong>{t.status}</strong><small>{current?.status ?? 'DRAFT'} · {current?.revisionNumber ? `${t.revision} ${current.revisionNumber}` : t.draft}</small></div><div className="surface-card"><strong>{t.visibility}</strong><select value={visibility} disabled={busy || current?.status === 'PUBLISHED'} onChange={event => setVisibility(event.target.value as DesktopPublicationVisibility)}><option value="PUBLIC">{t.public}</option><option value="UNLISTED">{t.unlisted}</option><option value="CONTACTS">{t.scoped}</option><option value="FOLLOWERS">{t.scoped}</option><option value="SELECTED_IDENTITIES">{t.scoped}</option><option value="SPACE">{t.scoped}</option></select></div></div><div className="surface-grid"><button className="secondary-button" disabled={busy} onClick={() => void runtime.preview(publicationId).then(value => setPreview(value ? `${value.title} · ${value.publisherIdentity}` : t.noPreview))}>{t.preview}</button>{current?.status === 'PUBLISHED' ? <button className="secondary-button" disabled={busy} onClick={() => void run(() => runtime.unpublish(publicationId))}>{t.unpublish}</button> : <button className="primary-button" disabled={busy} onClick={() => { if (typeof window !== 'undefined' && !window.confirm(t.publishConfirm)) return; void run(() => runtime.publish(publicationId, { visibility, ownerConfirmed: true })); }}>{t.publish}</button>}</div>{preview && <div className="adapter-note"><span>✓</span><div><strong>{t.preview}</strong><small>{preview}</small></div></div>}{current?.link && <div className="object-id"><span>{t.shareLink}</span><code>{current.link}</code></div>}</div>;
}

function PluginsSurface({ t }: { t: Copy }) {
  const ru = t.plugins === 'Плагины';
  return <div className="object-surface" data-plugin-surface="true"><div className="surface-kicker"><span className="surface-icon"><Icon name="plugins" size={15} /></span><span>{t.plugins}</span><span className="surface-badge">LOCAL</span></div><h1>{t.plugins}</h1><p className="surface-description">{ru ? 'Расширения работают только с явно разрешёнными возможностями и не получают доступ к личным данным сами.' : 'Extensions use only the capabilities you explicitly allow and do not receive personal data by default.'}</p><div className="surface-grid"><div className="surface-card"><strong>{ru ? 'Установлено' : 'Installed'}</strong><small>0</small></div><div className="surface-card"><strong>{ru ? 'Источники' : 'Sources'}</strong><small>{ru ? 'Файл · ссылка · локальное устройство' : 'File · link · local device'}</small></div><div className="surface-card"><strong>{ru ? 'Обновления' : 'Updates'}</strong><small>{ru ? 'Каждое обновление требует подтверждения' : 'Every update requires confirmation'}</small></div><div className="surface-card"><strong>{ru ? 'Восстановление' : 'Recovery'}</strong><small>{ru ? 'Только из выбранного владельцем файла' : 'Only from a file you choose'}</small></div><div className="surface-card"><strong>{ru ? 'Безопасность' : 'Safety'}</strong><small>{ru ? 'Публичный результат проверяется перед отправкой' : 'Public output is checked before sharing'}</small></div></div><p className="surface-description">{ru ? 'Получено, установлено и включено — разные действия, каждое подтверждается отдельно.' : 'Received, installed, and enabled are separate actions, each confirmed independently.'}</p></div>;
}

function HomeSurface({ shell, t, settings, onSettingChange }: { shell: DesktopShellController; t: Copy; settings: DesktopSettingsSnapshot; onSettingChange: (id: DesktopSettingId, value: unknown, scope?: DesktopSettingScope) => void }) {
  const [profile, setProfile] = React.useState(getLocalDesktopProfile);
  const [todayTasks, setTodayTasks] = React.useState<readonly DesktopTask[]>([]);
  const [recentTasks, setRecentTasks] = React.useState<readonly DesktopTask[]>([]);
  const [recentDocuments, setRecentDocuments] = React.useState<Awaited<ReturnType<DesktopDocumentsRuntime['recent']>>>([]);
  const [recentCaptures, setRecentCaptures] = React.useState<Awaited<ReturnType<DesktopCaptureRuntime['list']>>['items']>([]);
  const [notice, setNotice] = React.useState('');
  const ru = t.home === 'Главная';
  const hiddenSections = new Set(settings.values['home.hiddenSections']);
  const sectionOrder = settings.values['home.sectionOrder'];
  const sectionIndex = (id: HomeSectionId) => { const index = sectionOrder.indexOf(id); return index < 0 ? sectionOrder.length : index; };
  const sectionStyle = (id: HomeSectionId): React.CSSProperties => ({ order: sectionIndex(id) });
  const openCustomize = () => shell.openReference({ kind: 'settings', id: 'customize', label: ru ? 'Настроить Keystone' : 'Customize Keystone' });
  void onSettingChange;
  const refresh = React.useCallback(async () => {
    setProfile(getLocalDesktopProfile());
    const capture = getDesktopCaptureRuntime();
    const tasks = getDesktopTasksRuntime();
    const documents = getDesktopDocumentsRuntime();
    const [today, recent, docs, captures] = await Promise.allSettled([
      tasks?.tasks({ view: 'TODAY', limit: 6 }),
      tasks?.tasks({ view: 'ALL', limit: 6 }),
      documents?.recent(),
      capture?.list({ limit: 6 }),
    ]);
    setTodayTasks(today.status === 'fulfilled' ? today.value?.items ?? [] : []);
    setRecentTasks(recent.status === 'fulfilled' ? recent.value?.items ?? [] : []);
    setRecentDocuments(docs.status === 'fulfilled' ? docs.value ?? [] : []);
    setRecentCaptures(captures.status === 'fulfilled' ? captures.value?.items ?? [] : []);
    if ([today, recent, docs, captures].every(result => result.status === 'rejected')) setNotice(ru ? 'Некоторые разделы станут доступны после подключения.' : 'Some sections will appear after they are connected.');
    else setNotice('');
  }, [ru]);
  React.useEffect(() => { void refresh(); const unsubscribers = [subscribeDesktopCaptureRuntime(refresh), subscribeDesktopTasksRuntime(refresh), subscribeDesktopDocumentsRuntime(refresh)]; return () => unsubscribers.forEach(unsubscribe => unsubscribe()); }, [refresh]);
  const open = (ref: KeystoneObjectReference) => shell.openReference(ref);
  const continueItems: Array<{ key: string; icon: IconName; title: string; detail: string; ref: KeystoneObjectReference }> = [
    ...recentDocuments.slice(0, 2).map(item => ({ key: `document:${item.documentId}`, icon: 'document' as const, title: item.title, detail: `${item.format} · ${item.filename}`, ref: { kind: 'document' as const, id: item.file.fileId, label: item.title } })),
    ...recentTasks.slice(0, 2).map(item => ({ key: `task:${item.id}`, icon: 'task' as const, title: item.title, detail: [taskStatusLabel(item.status, ru), taskPriorityLabel(item.priority, ru)].filter(Boolean).join(' · '), ref: { kind: 'tasks' as const, id: item.id, label: item.title } })),
    ...recentCaptures.slice(0, 2).map(item => ({ key: `capture:${item.id}`, icon: 'capture' as const, title: item.title, detail: `${captureStateLabel(item.state, ru)} · ${captureSourceLabel(item.provenance.source.kind, ru)}`, ref: { kind: 'capture' as const, id: item.id, label: item.title } })),
  ];
  const pinnedTabs = shell.getSnapshot().workspace.tabs.filter(tab => tab.pinned && tab.kind !== 'home').slice(0, 6);
  const hasContinue = continueItems.length > 0;
  const hasToday = todayTasks.length > 0;
  const hasRecent = recentDocuments.length > 0 || recentCaptures.length > 0;
  const hasHomeColumns = (hasToday && !hiddenSections.has('today')) || (hasRecent && !hiddenSections.has('recent'));
  return <div className={`home-surface home-customizable home-density-${settings.values['home.density']}`} data-keystone-region="home" data-home-hidden={Array.from(hiddenSections).join(' ')} data-home-order={sectionOrder.join(' ')}>
    <div className="home-heading">
      <div>
        <h1>{profile ? `${ru ? 'Добро пожаловать, ' : 'Welcome, '}${profile.displayName}` : t.home}</h1>
        <p className="surface-description">{ru ? 'Ваше рабочее пространство на этом устройстве.' : 'Your workspace on this device.'}</p>
      </div>
      <div className="home-heading-actions"><button type="button" className="quiet-button" onClick={openCustomize}><Icon name="sliders" size={14} /> {ru ? 'Настроить' : 'Customize'}</button></div>
    </div>
    {!hasContinue && !hasHomeColumns && <section className="home-section home-start" data-home-section="start">
      <div className="home-section-heading"><h2>{ru ? 'Быстрые действия' : 'Quick actions'}</h2></div>
      <div className="home-continue-grid">{([
        ['task', ru ? 'Новая задача' : 'New task', ru ? 'Запишите, что нужно сделать' : 'Write down what needs doing', { kind: 'tasks', id: 'new-task', label: ru ? 'Новая задача' : 'New task' }],
        ['capture', t.capture, ru ? 'Сохраните текст, ссылку или файл' : 'Save text, a link or a file', { kind: 'capture', id: 'capture', label: t.capture }],
        ['document', ru ? 'Новый документ' : 'New document', ru ? 'Начните с черновика Markdown' : 'Start a Markdown draft', { kind: 'document', id: 'new-document', label: ru ? 'Новый документ' : 'New document' }],
        ['files', t.files, ru ? 'Откройте папки и импортируйте файлы' : 'Browse folders and import files', { kind: 'file', id: 'file', label: t.files }],
        ['search', t.search, ru ? 'Найдите объекты на устройстве' : 'Find items on this device', { kind: 'settings', id: 'search', label: t.search }],
        ['bot', t.localAI, ru ? 'Откройте чат с локальной моделью' : 'Open a chat with a local model', { kind: 'ai', id: 'ai', label: t.localAI }],
      ] as const).map(([icon, title, detail, ref]) => <button type="button" className="home-continue-card" key={ref.id} onClick={() => open(ref)}><span className="home-card-icon"><Icon name={icon} size={18} /></span><span><strong>{title}</strong><small>{detail}</small></span><Icon name="chevron-right" size={15} /></button>)}</div>
    </section>}
    {!hiddenSections.has('continue') && hasContinue && <section className="home-section" data-home-section="continue" style={sectionStyle('continue')}><div className="home-section-heading"><div><span className="section-label">{ru ? 'Продолжить' : 'Continue'}</span><h2>{ru ? 'С того места, где остановились' : 'Pick up where you left off'}</h2></div><Icon name="arrow-right" size={18} /></div><div className="home-continue-grid">{continueItems.map(item => <button type="button" className="home-continue-card" key={item.key} onClick={() => open(item.ref)}><span className="home-card-icon"><Icon name={item.icon} size={18} /></span><span><strong>{item.title}</strong><small>{item.detail}</small></span><Icon name="chevron-right" size={15} /></button>)}</div></section>}
    {hasHomeColumns && <div className="home-columns">{!hiddenSections.has('today') && hasToday && <section className="home-section home-today" data-home-section="today" style={sectionStyle('today')}><div className="home-section-heading"><div><span className="section-label">{ru ? 'Сегодня' : 'Today'}</span><h2>{ru ? 'План на сегодня' : 'Plan for today'}</h2></div><Icon name="calendar" size={18} /></div><div className="home-list">{todayTasks.map(task => <button type="button" key={task.id} onClick={() => open({ kind: 'tasks', id: task.id, label: task.title })}><span className="home-list-check"><Icon name={task.status === 'COMPLETED' ? 'check-circle' : 'circle'} size={15} /></span><span><strong>{task.title}</strong><small>{[formatTaskDate(task.due, ru ? 'ru' : 'en'), taskPriorityLabel(task.priority, ru)].filter(Boolean).join(' · ')}</small></span><Icon name="chevron-right" size={14} /></button>)}</div></section>}
      {!hiddenSections.has('recent') && hasRecent && <section className="home-section home-recent" data-home-section="recent" style={sectionStyle('recent')}><div className="home-section-heading"><div><span className="section-label">{ru ? 'Недавнее' : 'Recent'}</span><h2>{ru ? 'Локальная активность' : 'Local activity'}</h2></div><Icon name="activity" size={18} /></div><div className="home-list">{recentDocuments.slice(0, 3).map(item => <button type="button" key={`doc:${item.documentId}`} onClick={() => open({ kind: 'document', id: item.file.fileId, label: item.title })}><span className="home-list-icon"><Icon name="document" size={15} /></span><span><strong>{item.title}</strong><small>{item.format} · {formatTimestamp(item.openedAt, ru)}</small></span><Icon name="chevron-right" size={14} /></button>)}{recentCaptures.slice(0, 3).map(item => <button type="button" key={`capture:${item.id}`} onClick={() => open({ kind: 'capture', id: item.id, label: item.title })}><span className="home-list-icon"><Icon name="capture" size={15} /></span><span><strong>{item.title}</strong><small>{captureStateLabel(item.state, ru)} · {captureSourceLabel(item.provenance.source.kind, ru)}</small></span><Icon name="chevron-right" size={14} /></button>)}</div></section>}
    </div>}
    {!hiddenSections.has('pinned') && pinnedTabs.length ? <section className="home-section home-pinned" data-home-section="pinned" style={sectionStyle('pinned')}><div className="home-section-heading"><div><span className="section-label">{ru ? 'Закреплено' : 'Pinned'}</span><h2>{ru ? 'Быстрый доступ' : 'Quick access'}</h2></div><Icon name="pin" size={18} /></div><div className="home-pinned-list">{pinnedTabs.map(tab => <button type="button" key={tab.id} onClick={() => shell.focusTab(tab.id)}><span className="home-card-icon">{tabIcon(tab.kind)}</span><span><strong>{tabTitle(tab, t)}</strong></span></button>)}</div></section> : null}
    {notice ? <p className="home-notice" role="status"><Icon name="info" size={14} /> {notice}</p> : null}</div>;
}

function NoticeToast({ notice, t, onClose }: { notice: string; t: Copy; onClose: () => void }) {
  const [visibleNotice, setVisibleNotice] = React.useState(notice);
  React.useEffect(() => {
    setVisibleNotice(notice);
    if (!notice) return undefined;
    const timer = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(timer);
  }, [notice, onClose]);
  if (!visibleNotice) return null;
  const ru = t.home === 'Главная';
  const localized = ru
    ? ({
        'This tab is already open in another Keystone window.': 'Эта вкладка уже открыта в другом окне Keystone.',
        'Native Keystone windows are available in the desktop host.': 'Отдельные окна Keystone доступны в настольной оболочке.',
        'The native Keystone window could not be opened.': 'Не удалось открыть отдельное окно Keystone.',
        'Keep one tab in the main window so Keystone always has a home.': 'Оставьте одну вкладку в главном окне, чтобы у Keystone всегда была главная.',
      } as Record<string, string>)[visibleNotice] ?? visibleNotice
    : visibleNotice;
  return <div className="notice-toast" role="status" aria-live="polite"><span className="notice-toast-mark"><Icon name="info" size={14} /></span><span>{localized}</span><button type="button" className="notice-toast-close" onClick={onClose} aria-label={t.close}><Icon name="close" size={13} /></button></div>;
}

function MediaAdapterEmpty({ icon, title, detail }: { icon: IconName; title: string; detail: string }) {
  return <div className="adapter-note media-adapter-empty"><span><Icon name={icon} size={18} /></span><div><strong>{title}</strong><small>{detail}</small></div></div>;
}

function MusicSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopMusicRuntime | undefined>(getDesktopMusicRuntime);
  const [tracks, setTracks] = React.useState<readonly Extract<import('@keystone/core').MusicObject, { type: 'track' }>[]>([]);
  const [library, setLibrary] = React.useState<readonly Extract<import('@keystone/core').MusicObject, { type: 'library_entry' }>[]>([]);
  const [playingId, setPlayingId] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [playbackState, setPlaybackState] = React.useState(runtime?.state?.() ?? { playing: false, currentTimeMs: 0, durationMs: 0, volume: 1, muted: false });
  const ru = t.music === 'Музыка';
  const refresh = React.useCallback(async () => {
    if (!runtime) { setTracks([]); setLibrary([]); return; }
    const [nextTracks, nextLibrary] = await Promise.allSettled([runtime.music.tracks(), runtime.music.library()]);
    setTracks(nextTracks.status === 'fulfilled' ? nextTracks.value : []);
    setLibrary(nextLibrary.status === 'fulfilled' ? nextLibrary.value : []);
  }, [runtime]);
  React.useEffect(() => subscribeDesktopMusicRuntime(() => setRuntime(getDesktopMusicRuntime())), []);
  React.useEffect(() => { if (!runtime?.subscribe) return undefined; return runtime.subscribe(() => { const next = runtime.state?.(); if (next) { setPlaybackState(next); setPlayingId(next.playing ? next.currentId : undefined); } }); }, [runtime]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const play = async (index: number) => {
    if (!runtime || !tracks[index]) return;
    setBusy(true); setNotice('');
    try { await runtime.playback.setEligibleQueue(tracks, index); await runtime.playback.play(); setPlayingId(tracks[index].id); }
    catch (error) { setNotice(errorText(error, (ru ? 'Воспроизведение недоступно.' : 'Playback is unavailable.'))); }
    finally { setBusy(false); }
  };
  const save = async (trackId: string) => {
    if (!runtime) return;
    try { await runtime.music.saveToLibrary(trackId); await refresh(); }
    catch (error) { setNotice(errorText(error, (ru ? 'Не удалось сохранить трек.' : 'Could not save the track.'))); }
  };
  const importAudioFile = async (file: { readonly name: string; readonly mimeType: string; readonly bytes: Uint8Array }) => {
    if (!runtime?.importTrack) return;
    setBusy(true); setNotice('');
    try { await runtime.importTrack({ filename: file.name, mimeType: file.mimeType, bytes: file.bytes }); await refresh(); setNotice(ru ? 'Аудио импортировано локально.' : 'Audio imported locally.'); }
    catch (error) { setNotice(errorText(error, (ru ? 'Не удалось импортировать аудио.' : 'Audio import failed.'))); }
    finally { setBusy(false); }
  };
  const importAudio = async () => {
    if (!runtime?.importTrack) return;
    try { const file = await pickDesktopFile('audio'); if (file) await importAudioFile(file); }
    catch (error) { setNotice(errorText(error, (ru ? 'Не удалось открыть выбор аудио.' : 'Could not open the audio picker.'))); }
  };
  const importDroppedAudio = async (file: File) => importAudioFile({ name: file.name, mimeType: file.type || 'application/octet-stream', bytes: new Uint8Array(await file.arrayBuffer()) });
  if (!runtime) return <div className="media-surface"><MediaSurfaceHeading icon="rss" title={t.music} detail={ru ? 'Музыкальные объекты Keystone и локальная библиотека.' : 'Keystone music objects and the local library.'} /><MediaAdapterEmpty icon="rss" title={ru ? 'Музыка не подключена' : 'Music is not connected'} detail={ru ? 'Подключите локальную библиотеку или импортируйте аудио. Пустые треки не создаются автоматически.' : 'Connect a local library or import audio. Empty tracks are never created automatically.'} /></div>;
  return <div className="media-surface" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); const file = event.dataTransfer.files[0]; if (file) void importDroppedAudio(file); }}><MediaSurfaceHeading icon="rss" title={t.music} detail={ru ? 'Локальная музыкальная библиотека и воспроизведение.' : 'Local music library and playback.'} action={<div className="media-heading-actions"><button className="secondary-button" onClick={() => void refresh()}>{t.refresh}</button>{runtime.importTrack ? <button className="primary-button" disabled={busy} onClick={() => void importAudio()}>{ru ? 'Импортировать аудио' : 'Import audio'}</button> : null}</div>} />
    <div className="media-summary"><span><strong>{tracks.length}</strong><small>{ru ? ruPlural(tracks.length, 'трек', 'трека', 'треков') : tracks.length === 1 ? 'track' : 'tracks'}</small></span><span><strong>{library.length}</strong><small>{ru ? 'в библиотеке' : 'in library'}</small></span><span><strong>{ru ? 'На устройстве' : 'On this device'}</strong><small>{ru ? 'источник воспроизведения' : 'playback source'}</small></span></div>
    {playbackState.currentId ? <MediaControlBar state={playbackState} ru={ru} onSeek={value => void runtime.playback.seek(value)} onVolume={value => runtime.setVolume?.(value)} /> : null}
    {tracks.length ? <div className="media-list">{tracks.slice(0, 100).map((track, index) => <div className={`media-row${playingId === track.id ? ' active' : ''}`} key={track.id}><span className="media-row-icon"><Icon name={playingId === track.id ? 'pause' : 'play'} size={16} /></span><span className="media-row-copy"><strong>{track.payload.title}</strong><small>{formatMediaDuration(track.payload.durationMs)} · {track.payload.codec.toUpperCase()}</small></span><button className="secondary-button" disabled={busy} onClick={() => playingId === track.id ? void runtime.playback.pause().then(() => setPlayingId(undefined)) : void play(index)}>{playingId === track.id ? (ru ? 'Пауза' : 'Pause') : (ru ? 'Играть' : 'Play')}</button><button className="quiet-button" onClick={() => void save(track.payload.trackId)} disabled={library.some(item => item.payload.trackId === track.payload.trackId)}>{library.some(item => item.payload.trackId === track.payload.trackId) ? (ru ? 'Сохранено' : 'Saved') : (ru ? 'В библиотеку' : 'Save')}</button></div>)}</div> : <MediaAdapterEmpty icon="rss" title={ru ? 'Локальных треков пока нет' : 'No local tracks yet'} detail={ru ? 'Импортируйте аудио, чтобы оно появилось в библиотеке устройства.' : 'Import audio to add it to the device library.'} />}
    {notice && <p className="surface-notice" role="status">{notice}</p>}
    <TypedReferenceDock tab={tab} shell={shell} t={t} />
  </div>;
}

function VideoSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopVideoRuntime | undefined>(getDesktopVideoRuntime);
  const [videos, setVideos] = React.useState<readonly import('@keystone/core').VideoObject[]>([]);
  const [selectedVideo, setSelectedVideo] = React.useState<import('@keystone/core').VideoObject>();
  const [playingId, setPlayingId] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [playbackState, setPlaybackState] = React.useState(runtime?.state?.() ?? { playing: false, currentTimeMs: 0, durationMs: 0, volume: 1, muted: false });
  const [nativePlayback, setNativePlayback] = React.useState(runtime?.nativePlayback?.() ?? false);
  const ru = t.video === 'Видео';
  const refresh = React.useCallback(async () => {
    if (!runtime) { setVideos([]); return; }
    try { setVideos((await runtime.videos.videos()).filter(video => !video.payload.shortForm)); }
    catch (error) { setNotice(errorText(error, (ru ? 'Видео недоступно.' : 'Video is unavailable.'))); }
  }, [runtime, ru]);
  React.useEffect(() => subscribeDesktopVideoRuntime(() => setRuntime(getDesktopVideoRuntime())), []);
  React.useEffect(() => { if (!runtime?.subscribe) return undefined; return runtime.subscribe(() => { const next = runtime.state?.(); if (next) { setPlaybackState(next); setPlayingId(next.playing ? next.currentId : undefined); } setNativePlayback(runtime.nativePlayback?.() ?? false); }); }, [runtime]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const play = async (video: import('@keystone/core').VideoObject) => {
    if (!runtime) return;
    setSelectedVideo(video);
    setBusy(true); setNotice('');
    try { await runtime.playback.play(video); setPlayingId(video.id); }
    catch (error) { setNotice(errorText(error, (ru ? 'Воспроизведение недоступно.' : 'Playback is unavailable.'))); }
    finally { setBusy(false); }
  };
  const importVideo = async () => {
    if (!runtime?.importVideo) return;
    setBusy(true); setNotice('');
    try { const file = await pickDesktopFile('video'); if (file) { await runtime.importVideo({ filename: file.name, mimeType: file.mimeType, bytes: file.bytes }); await refresh(); setNotice(ru ? 'Видео импортировано локально.' : 'Video imported locally.'); } }
    catch (error) { setNotice(errorText(error, (ru ? 'Не удалось импортировать видео.' : 'Video import failed.'))); }
    finally { setBusy(false); }
  };
  const importDroppedVideo = async (file: File) => {
    if (!runtime?.importVideo) return;
    setBusy(true); setNotice('');
    try { await runtime.importVideo({ filename: file.name, mimeType: file.type || 'application/octet-stream', bytes: new Uint8Array(await file.arrayBuffer()) }); await refresh(); setNotice(ru ? 'Видео импортировано локально.' : 'Video imported locally.'); }
    catch (error) { setNotice(errorText(error, (ru ? 'Не удалось импортировать видео.' : 'Video import failed.'))); }
    finally { setBusy(false); }
  };
  const videoRef = React.useCallback((element: HTMLVideoElement | null) => runtime?.attachVideoElement?.(element), [runtime]);
  if (!runtime) return <div className="media-surface"><MediaSurfaceHeading icon="play" title={t.video} detail={ru ? 'Видео Keystone и локальное воспроизведение.' : 'Keystone video and local playback.'} /><MediaAdapterEmpty icon="play" title={ru ? 'Видео пока недоступно' : 'Video is not available yet'} detail={ru ? 'Добавьте видеофайл или подключите локальную библиотеку.' : 'Add a video file or connect a local library.'} /></div>;
  return <div className="media-surface" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); const file = event.dataTransfer.files[0]; if (file) void importDroppedVideo(file); }}><MediaSurfaceHeading icon="play" title={t.video} detail={ru ? 'Полноразмерное видео из локальной библиотеки.' : 'Full-length video from the local library.'} action={<div className="media-heading-actions"><button className="secondary-button" onClick={() => void refresh()}>{t.refresh}</button>{runtime.importVideo ? <button className="primary-button" disabled={busy} onClick={() => void importVideo()}>{ru ? 'Импортировать видео' : 'Import video'}</button> : null}</div>} />
    {selectedVideo ? <div className="media-player">{nativePlayback ? <NativeVideoStage title={selectedVideo.payload.title} ru={ru} /> : <video ref={videoRef} className="desktop-media-video" controls playsInline aria-label={selectedVideo.payload.title} />}<MediaControlBar state={playbackState} ru={ru} onSeek={value => void runtime.playback.seek(value)} onVolume={value => runtime.setVolume?.(value)} onToggleMute={runtime.setMuted ? () => runtime.setMuted?.(!playbackState.muted) : undefined} onFullscreen={!nativePlayback && runtime.toggleFullscreen ? () => void runtime.toggleFullscreen?.() : undefined} /></div> : null}
    {videos.length ? <div className="media-list">{videos.slice(0, 100).map(video => <div className={`media-row media-video-row${playingId === video.id ? ' active' : ''}`} key={video.id}><span className="media-row-icon"><Icon name={playingId === video.id ? 'pause' : 'play'} size={16} /></span><span className="media-row-copy"><strong>{video.payload.title}</strong><small>{formatMediaDuration(video.payload.durationMs)} · {video.payload.videoStream.container.toUpperCase()}</small></span><button className="secondary-button" disabled={busy} onClick={() => playingId === video.id ? void runtime.playback.pause().then(() => setPlayingId(undefined)) : void play(video)}>{playingId === video.id ? (ru ? 'Пауза' : 'Pause') : (ru ? 'Открыть' : 'Play')}</button><button className="quiet-button" disabled={playingId !== video.id} onClick={() => void runtime.playback.setSaved(true).then(() => setNotice(ru ? 'Видео сохранено локально.' : 'Video saved locally.')).catch(error => setNotice(error instanceof Error ? error.message : 'Save failed'))}>{ru ? 'Сохранить' : 'Save'}</button></div>)}</div> : <MediaAdapterEmpty icon="play" title={ru ? 'Локальных видео пока нет' : 'No local videos yet'} detail={ru ? 'Импортируйте видео, чтобы добавить его в библиотеку устройства.' : 'Import a video to add it to the device library.'} />}
    {notice && <p className="surface-notice" role="status">{notice}</p>}
    <TypedReferenceDock tab={tab} shell={shell} t={t} />
  </div>;
}

function ShortsSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopShortsRuntime | undefined>(getDesktopShortsRuntime);
  const [items, setItems] = React.useState<readonly import('@keystone/core').ShortVideoObject[]>([]);
  const [currentId, setCurrentId] = React.useState<string>();
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [playbackState, setPlaybackState] = React.useState(runtime?.state?.() ?? { playing: false, currentTimeMs: 0, durationMs: 0, volume: 1, muted: false });
  const [nativePlayback, setNativePlayback] = React.useState(runtime?.nativePlayback?.() ?? false);
  const ru = t.shorts === 'Shorts';
  const refresh = React.useCallback(async () => {
    if (!runtime) { setItems([]); return; }
    try { const next = await runtime.shorts.list(); setItems(next); runtime.feed.setItems(next); setCurrentId(next[0]?.id); }
    catch (error) { setNotice(errorText(error, (ru ? 'Лента Shorts недоступна.' : 'Shorts are unavailable.'))); }
  }, [runtime, ru]);
  React.useEffect(() => subscribeDesktopShortsRuntime(() => setRuntime(getDesktopShortsRuntime())), []);
  React.useEffect(() => { if (!runtime?.subscribe) return undefined; return runtime.subscribe(() => { const next = runtime.state?.(); if (next) setPlaybackState(next); setNativePlayback(runtime.nativePlayback?.() ?? false); }); }, [runtime]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const videoRef = React.useCallback((element: HTMLVideoElement | null) => runtime?.attachVideoElement?.(element), [runtime]);
  const currentIndex = Math.max(0, items.findIndex(item => item.id === currentId));
  const openAt = async (index: number) => {
    if (!runtime || !items[index]) return;
    setBusy(true); setNotice('');
    try { runtime.feed.setItems(items, index); await runtime.feed.openCurrent(); setCurrentId(items[index].id); }
    catch (error) { setNotice(errorText(error, (ru ? 'Не удалось открыть короткое видео.' : 'Short could not be opened.'))); }
    finally { setBusy(false); }
  };
  const move = async (delta: -1 | 1) => {
    if (!runtime || !items.length) return;
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    setBusy(true); setNotice('');
    try { await (delta > 0 ? runtime.feed.next() : runtime.feed.previous()); setCurrentId(items[nextIndex].id); }
    catch (error) { setNotice(errorText(error, (ru ? 'Не удалось переключить ленту Shorts.' : 'Could not move through Shorts.'))); }
    finally { setBusy(false); }
  };
  const importShort = async () => {
    if (!runtime?.importVideo) return;
    setBusy(true); setNotice('');
    try { const file = await pickDesktopFile('video'); if (file) { await runtime.importVideo({ filename: file.name, mimeType: file.mimeType, bytes: file.bytes, shortForm: true }); await refresh(); setNotice(ru ? 'Короткое видео импортировано локально.' : 'Short imported locally.'); } }
    catch (error) { setNotice(errorText(error, (ru ? 'Не удалось импортировать короткое видео.' : 'Short import failed.'))); }
    finally { setBusy(false); }
  };
  const current = items.find(item => item.id === currentId) ?? items[0];
  if (!runtime) return <div className="media-surface"><MediaSurfaceHeading icon="play" title={t.shorts} detail={ru ? 'Короткие видео из локальной библиотеки.' : 'Short-form video from the local library.'} /><MediaAdapterEmpty icon="play" title={ru ? 'Лента Shorts не подключена' : 'Shorts are not connected'} detail={ru ? 'Импортируйте настоящий вертикальный видеофайл, чтобы добавить короткое видео.' : 'Import a real vertical video file to add a Short.'} /></div>;
  return <div className="media-surface shorts-surface"><MediaSurfaceHeading icon="play" title={t.shorts} detail={ru ? 'Локальная лента коротких видео с безопасной предварительной загрузкой.' : 'A local short-video feed with safe preloading.'} action={<div className="media-heading-actions"><button className="secondary-button" onClick={() => void refresh()}>{t.refresh}</button>{runtime.importVideo ? <button className="primary-button" disabled={busy} onClick={() => void importShort()}>{ru ? 'Импортировать короткое видео' : 'Import short'}</button> : null}</div>} />
    {current ? <><div className="shorts-stage"><div className="shorts-stage-icon"><Icon name="play" size={28} /></div><div><span className="section-label">{currentIndex + 1} / {items.length}</span><h2>{current.payload.title}</h2><p>{current.payload.shortForm?.caption ?? current.payload.description ?? (ru ? 'Без подписи.' : 'No caption.')}</p><small>{formatMediaDuration(current.payload.durationMs)} · {current.payload.videoStream.container}/{current.payload.videoStream.codec}</small></div></div><div className="shorts-player">{nativePlayback ? <NativeVideoStage title={current.payload.title} ru={ru} shortForm /> : <video ref={videoRef} className="desktop-media-video shorts-video" controls playsInline aria-label={current.payload.title} />}<MediaControlBar state={playbackState} ru={ru} onSeek={value => void runtime.seek?.(value)} onVolume={value => runtime.setVolume?.(value)} onToggleMute={runtime.setMuted ? () => runtime.setMuted?.(!playbackState.muted) : undefined} onFullscreen={!nativePlayback && runtime.toggleFullscreen ? () => void runtime.toggleFullscreen?.() : undefined} /></div><div className="media-actions"><button className="secondary-button" disabled={busy || currentIndex === 0} onClick={() => void move(-1)}>{ru ? 'Назад' : 'Previous'}</button><button className="primary-button" disabled={busy} onClick={() => void openAt(currentIndex)}>{ru ? 'Открыть / играть' : 'Open / play'}</button><button className="secondary-button" disabled={busy || currentIndex >= items.length - 1} onClick={() => void move(1)}>{ru ? 'Далее' : 'Next'}</button>{current.payload.creatorProfileId && runtime.followCreator && <button className="quiet-button" onClick={() => void runtime.followCreator?.(current.payload.creatorProfileId!).then(() => setNotice(ru ? 'Автор добавлен в подписки.' : 'Creator followed.'))}>{ru ? 'Подписаться' : 'Follow'}</button>}{runtime.shareToChat && <button className="quiet-button" onClick={() => void runtime.shareToChat?.(current.id)}>{ru ? 'В чат' : 'To chat'}</button>}</div><div className="media-list shorts-list">{items.slice(0, 100).map((item, index) => <button type="button" className={`media-row${item.id === current.id ? ' active' : ''}`} key={item.id} onClick={() => void openAt(index)}><span className="media-row-icon"><Icon name="play" size={15} /></span><span className="media-row-copy"><strong>{item.payload.title}</strong><small>{formatMediaDuration(item.payload.durationMs)} · {ru ? 'локально' : 'local'}</small></span></button>)}</div></> : <MediaAdapterEmpty icon="play" title={ru ? 'Лента Shorts пока пуста' : 'Shorts is empty'} detail={ru ? 'Импортируйте настоящий вертикальный видеофайл, чтобы добавить короткое видео.' : 'Import a real vertical video file to add a Short.'} />}
    {notice && <p className="surface-notice" role="status">{notice}</p>}
    <TypedReferenceDock tab={tab} shell={shell} t={t} />
  </div>;
}

function MediaSurfaceHeading({ icon, title, detail, action }: { icon: IconName; title: string; detail: string; action?: React.ReactNode }) {
  const localLabel = document.documentElement.lang === 'en' ? 'LOCAL' : 'ЛОКАЛЬНО';
  return <div className="media-heading"><div><div className="surface-kicker"><span className="surface-icon"><Icon name={icon} size={15} /></span><span>{title}</span><span className="surface-badge">{localLabel}</span></div><h1>{title}</h1><p className="surface-description">{detail}</p></div>{action}</div>;
}

function NativeVideoStage({ title, ru, shortForm = false }: { title: string; ru: boolean; shortForm?: boolean }) {
  return <div className={`native-video-stage${shortForm ? ' native-video-stage-short' : ''}`} role="status" aria-label={title}><Icon name="play" size={28} /><div><strong>{ru ? 'Видео воспроизводится в отдельном окне' : 'Video is playing in a separate window'}</strong><small>{ru ? 'Используется локальный проигрыватель устройства.' : 'The device local player is being used.'}</small></div></div>;
}


function MediaControlBar({ state, ru, onSeek, onVolume, onToggleMute, onFullscreen }: { state: { readonly currentTimeMs: number; readonly durationMs: number; readonly volume: number; readonly muted: boolean }; ru: boolean; onSeek: (value: number) => void; onVolume?: (value: number) => void; onToggleMute?: () => void; onFullscreen?: () => void }) {
  const duration = Math.max(1, state.durationMs);
  return <div className="media-control-bar"><label><span>{formatMediaDuration(state.currentTimeMs)}</span><input type="range" min={0} max={duration} step={100} value={Math.min(state.currentTimeMs, duration)} onChange={event => onSeek(Number(event.target.value))} aria-label={ru ? 'Позиция' : 'Position'} /><span>{formatMediaDuration(state.durationMs)}</span></label>{onVolume ? <label className="media-volume"><span>{ru ? 'Громкость' : 'Volume'}</span><input type="range" min={0} max={1} step={0.01} value={state.volume} onChange={event => onVolume(Number(event.target.value))} aria-label={ru ? 'Громкость' : 'Volume'} /></label> : null}{onToggleMute ? <button className="quiet-button" type="button" onClick={onToggleMute}>{state.muted ? (ru ? 'Включить звук' : 'Unmute') : (ru ? 'Выключить звук' : 'Mute')}</button> : null}{onFullscreen ? <button className="quiet-button" type="button" onClick={onFullscreen}>{ru ? 'На весь экран' : 'Fullscreen'}</button> : null}</div>;
}

function AISurface({ shell, t }: { shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopAIRuntime | undefined>(getDesktopAIRuntime);
  const [providerKind, setProviderKind] = React.useState<DesktopLocalAIProviderKind>('ollama');
  const [endpoint, setEndpoint] = React.useState('http://127.0.0.1:11434/api/chat');
  const [model, setModel] = React.useState('llama3.2');
  const [settings, setSettings] = React.useState<ReturnType<DesktopAIRuntime['settings']['snapshot']>>();
  const [health, setHealth] = React.useState<Awaited<ReturnType<DesktopAIRuntime['health']>>>();
  const [discoveredModels, setDiscoveredModels] = React.useState<readonly DesktopLocalAIModel[]>([]);
  const [discoverBusy, setDiscoverBusy] = React.useState(false);
  const [prompt, setPrompt] = React.useState('');
  const [answer, setAnswer] = React.useState('');
  const ownerIdentityId = getLocalDesktopProfile()?.ownerIdentityId ?? 'unbound';
  const [conversations, setConversations] = React.useState<readonly DesktopAIConversation[]>(() => readDesktopAIConversations(ownerIdentityId));
  const [activeConversationId, setActiveConversationId] = React.useState<string>(() => readDesktopAIConversations(ownerIdentityId)[0]?.id ?? '');
  const [generating, setGenerating] = React.useState(false);
  const abortRef = React.useRef<AbortController>();
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [showConfig, setShowConfig] = React.useState(false);
  const ru = t.localAI === 'Локальный AI';
  const refresh = React.useCallback(async () => {
    if (!runtime) return;
    const next = runtime.settings.snapshot();
    setSettings(next);
    const configured = next.models.find(item => item.scope === 'local' && item.endpoint);
    if (configured?.endpoint) setEndpoint(configured.endpoint);
    if (configured?.ref) { setModel(configured.ref.slice(configured.ref.indexOf('/') + 1)); setProviderKind(configured.ref.startsWith('ollama/') ? 'ollama' : configured.ref.startsWith('lm-studio/') ? 'lm-studio' : 'openai-compatible'); }
    setHealth(await runtime.health());
  }, [runtime]);
  React.useEffect(() => subscribeDesktopAIRuntime(() => setRuntime(getDesktopAIRuntime())), []);
  React.useEffect(() => { void refresh(); return runtime?.subscribe?.(() => { void refresh(); }); }, [refresh, runtime]);
  React.useEffect(() => {
    const next = readDesktopAIConversations(ownerIdentityId);
    setConversations(next); setActiveConversationId(next[0]?.id ?? '');
    const last = next[0]?.messages.at(-1);
    setAnswer(last?.role === 'assistant' ? last.text : '');
  }, [ownerIdentityId]);
  const configure = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!runtime) return;
    setBusy(true); setNotice('');
    try { const next = await runtime.configureLocalProvider({ kind: providerKind, endpoint, model }); setSettings(next); setHealth(await runtime.health()); setShowConfig(false); setNotice(ru ? 'Источник локальной модели сохранён.' : 'Local model source saved.'); }
    catch (error) { setNotice(errorText(error, (ru ? 'Не удалось настроить источник модели.' : 'Could not configure the model source.'))); }
    finally { setBusy(false); }
  };
  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!runtime || !prompt.trim()) return;
    setBusy(true); setGenerating(true); setNotice(''); setAnswer('');
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const userText = prompt.trim();
      const result = await runtime.streamPrivate({ userText, task: 'desktop-local-ai', signal: controller.signal }, setAnswer);
      if (!result.text.trim()) throw new Error(ru ? 'Модель вернула пустой ответ.' : 'The model returned an empty answer.');
      const existing = conversations.find(item => item.id === activeConversationId) ?? createDesktopAIConversation(userText.slice(0, 48));
      const now = new Date().toISOString();
      const nextConversation: DesktopAIConversation = { ...existing, title: existing.messages.length ? existing.title : userText.slice(0, 120), updatedAt: now, messages: [...existing.messages, { id: `ai-message:${globalThis.crypto.randomUUID()}`, role: 'user', text: userText, createdAt: now }, { id: `ai-message:${globalThis.crypto.randomUUID()}`, role: 'assistant', text: result.text, createdAt: new Date().toISOString() }] };
      const next = [nextConversation, ...conversations.filter(item => item.id !== nextConversation.id)].slice(0, 32);
      setConversations(next); setActiveConversationId(nextConversation.id); setAnswer(result.text); writeDesktopAIConversations(ownerIdentityId, next);
    }
    catch (error) { setNotice(controller.signal.aborted ? (ru ? 'Генерация остановлена. Неполный ответ не сохранён.' : 'Generation stopped. The partial answer was not saved.') : errorText(error, (ru ? 'Локальный AI недоступен.' : 'Local AI is unavailable.'))); }
    finally { abortRef.current = undefined; setGenerating(false); setBusy(false); }
  };
  const discover = async () => {
    if (!runtime) return;
    setDiscoverBusy(true); setNotice('');
    try { const found = await runtime.discoverModels({ kind: providerKind, endpoint }); setDiscoveredModels(found); if (found.length && !found.some(item => item.model === model)) setModel(found[0]!.model); setNotice(ru ? 'Список локальных моделей обновлён.' : 'Local model list updated.'); }
    catch (error) { setNotice(errorText(error, (ru ? 'Не удалось получить список моделей.' : 'Could not discover local models.'))); }
    finally { setDiscoverBusy(false); }
  };
  const newConversation = () => {
    const next = createDesktopAIConversation(ru ? 'Новый разговор' : 'New conversation');
    const all = [next, ...conversations].slice(0, 32);
    setConversations(all); setActiveConversationId(next.id); setAnswer('');
    try { writeDesktopAIConversations(ownerIdentityId, all); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const activeConversation = conversations.find(item => item.id === activeConversationId);
  if (!runtime) return <div className="ai-surface"><MediaSurfaceHeading icon="bot" title={t.localAI} detail={ru ? 'Приватные задачи направляются только в локальные модели.' : 'Private tasks are routed only to local models.'} /><MediaAdapterEmpty icon="bot" title={ru ? 'Локальный AI пока не подключён' : 'Local AI is not connected yet'} detail={ru ? 'Запросы не отправляются во внешние сервисы.' : 'Requests are not sent to external services.'} /></div>;
  const configured = settings?.models.find(item => item.scope === 'local');
  return <div className="ai-surface"><MediaSurfaceHeading icon="bot" title={t.localAI} detail={ru ? 'Ollama, LM Studio и другие локальные модели. Приватные запросы остаются на устройстве.' : 'Ollama, LM Studio, and other local models. Private requests stay on this device.'} action={<button className="secondary-button" onClick={() => void refresh()}>{t.refresh}</button>} />
    <div className="ai-status-grid"><div className="surface-card"><strong>{ru ? 'Источник' : 'Source'}</strong><small>{configured?.displayName ?? (ru ? 'не настроен' : 'not configured')}</small></div><div className="surface-card"><strong>{ru ? 'Проверка' : 'Health'}</strong><small>{health?.state ?? (ru ? 'не проверен' : 'not checked')}{health?.detail ? ` · ${health.detail}` : ''}</small></div><div className="surface-card"><strong>{ru ? 'Внешняя сеть' : 'External network'}</strong><small>{settings?.remoteEnabled === false ? (ru ? 'запрещена' : 'disabled') : (ru ? 'проверяется' : 'not enabled')}</small></div></div>
    {showConfig ? <form className="ai-config-form" onSubmit={configure}><span className="section-label">{ru ? 'Источник локальной модели' : 'Local model source'}</span><div className="ai-form-grid"><label><span>{ru ? 'Система' : 'System'}</span><select value={providerKind} onChange={event => { const next = event.target.value as DesktopLocalAIProviderKind; setProviderKind(next); setDiscoveredModels([]); if (next === 'ollama') setEndpoint('http://127.0.0.1:11434/api/chat'); else if (next === 'lm-studio') setEndpoint('http://127.0.0.1:1234/v1/chat/completions'); }}><option value="ollama">Ollama</option><option value="lm-studio">LM Studio</option><option value="openai-compatible">OpenAI-compatible localhost</option><option value="built-in">Built-in native host</option><option value="llama.cpp">llama.cpp native host</option></select></label><label><span>{ru ? 'Адрес подключения' : 'Connection address'}</span><input value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="http://127.0.0.1:11434/api/chat" /></label><label><span>{ru ? 'Модель' : 'Model'}</span><input list="desktop-ai-models" value={model} onChange={event => setModel(event.target.value)} placeholder="llama3.2" /><datalist id="desktop-ai-models">{discoveredModels.map(item => <option key={item.model} value={item.model}>{item.displayName}</option>)}</datalist></label><button className="primary-button" disabled={busy} type="submit">{t.configure}</button></div><div className="ai-config-actions"><button className="secondary-button" type="button" disabled={discoverBusy || !endpoint.trim() || providerKind === 'built-in' || providerKind === 'llama.cpp'} onClick={() => void discover()}>{discoverBusy ? <Icon name="loader" size={14} /> : <Icon name="search" size={14} />}{ru ? 'Найти модели' : 'Discover models'}</button><button className="quiet-button" type="button" onClick={() => setShowConfig(false)}>{ru ? 'Отмена' : 'Cancel'}</button>{discoveredModels.length ? <div className="ai-discovered-models" aria-label={ru ? 'Найденные модели' : 'Discovered models'}>{discoveredModels.map(item => <button type="button" className={item.model === model ? 'selected' : ''} key={item.model} onClick={() => setModel(item.model)}>{item.displayName}{item.ownedBy ? <small>{item.ownedBy}</small> : null}</button>)}</div> : null}</div></form> : <div className="ai-source-summary"><div><strong>{configured?.displayName ?? (ru ? 'Источник не настроен' : 'No source configured')}</strong><small>{configured ? (ru ? 'Готов к локальному разговору.' : 'Ready for a local conversation.') : (ru ? 'Выберите локальную модель, чтобы начать.' : 'Choose a local model to get started.')}</small></div><button className="secondary-button" type="button" onClick={() => setShowConfig(true)}>{configured ? (ru ? 'Изменить источник' : 'Change source') : (ru ? 'Настроить источник' : 'Set up source')}</button></div>}
    <section className="ai-conversations"><div className="ai-conversation-heading"><span className="section-label">{ru ? 'Локальные разговоры' : 'Local conversations'}</span><button className="secondary-button" type="button" onClick={newConversation} disabled={busy}>{ru ? 'Новый разговор' : 'New conversation'}</button></div>{conversations.length ? <div className="ai-conversation-list">{conversations.map(item => <button type="button" key={item.id} className={item.id === activeConversationId ? 'selected' : undefined} onClick={() => { setActiveConversationId(item.id); const last = item.messages.at(-1); setAnswer(last?.role === 'assistant' ? last.text : ''); }}>{item.title}<small>{item.messages.length} {ru ? 'сообщений' : 'messages'}</small></button>)}</div> : <p className="ai-conversation-empty">{ru ? 'Ответы сохраняются только после успешного локального запроса.' : 'Responses are saved only after a successful local request.'}</p>}</section>
    <form className="ai-run-form" onSubmit={run}><span className="section-label">{ru ? 'Приватный запрос' : 'Private request'}{activeConversation ? ` · ${activeConversation.title}` : ''}</span><textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={ru ? 'Запрос остаётся на устройстве…' : 'The request stays on this device…'} rows={3} disabled={!configured || busy} /><div className="ai-run-actions"><button className="primary-button" type="submit" disabled={!configured || busy || !prompt.trim()}>{busy ? <Icon name="loader" size={14} /> : <Icon name="bot" size={14} />}{ru ? 'Выполнить локально' : 'Run locally'}</button>{generating ? <button className="secondary-button" type="button" onClick={() => abortRef.current?.abort()}>{ru ? 'Остановить' : 'Stop'}</button> : null}</div>{answer && <div className="ai-answer" aria-live="polite" aria-busy={generating}><strong>{ru ? 'Ответ' : 'Response'}</strong><p>{answer}</p></div>}{activeConversation?.messages.length ? <div className="ai-message-history">{activeConversation.messages.map(message => <div className={`ai-message ${message.role}`} key={message.id}><span>{message.role === 'user' ? (ru ? 'Вы' : 'You') : 'AI'}</span><p>{message.text}</p></div>)}</div> : null}</form>
    {notice && <p className="surface-notice" role="status">{notice}</p>}
  </div>;
}

function ConnectivitySurface({ t }: { t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopNetworkRuntime | undefined>(getDesktopNetworkRuntime);
  const [, setVersion] = React.useState(0);
  const ru = t.connectivity === 'Связь';
  React.useEffect(() => subscribeDesktopNetworkRuntime(() => setRuntime(getDesktopNetworkRuntime())), []);
  React.useEffect(() => runtime?.subscribe?.(() => setVersion(value => value + 1)), [runtime]);
  if (!runtime) return <div className="network-surface"><MediaSurfaceHeading icon="network" title={t.connectivity} detail={ru ? 'Состояние сети и доступные способы соединения.' : 'Network status and available connection methods.'} /><MediaAdapterEmpty icon="network" title={ru ? 'Связь пока не подключена' : 'Connectivity is not connected yet'} detail={ru ? 'Нужен локальный способ соединения, чтобы показать доступные устройства.' : 'A local connection is needed to show available devices.'} /></div>;
  const state = runtime.snapshot();
  const configuration = runtime.configuration();
  const flag = (value: boolean | 'UNKNOWN') => value === true ? (ru ? 'доступно' : 'available') : value === false ? (ru ? 'нет' : 'no') : (ru ? 'неизвестно' : 'unknown');
  return <div className="network-surface"><MediaSurfaceHeading icon="network" title={t.connectivity} detail={ru ? 'Состояние сети и доступные способы соединения.' : 'Network status and available connection methods.'} /><div className="network-state-card"><div><span className="section-label">{ru ? 'Текущее состояние' : 'Current state'}</span><h2>{networkStateLabel(state.state, ru)}</h2><small>{networkReachabilityLabel(state.reachability, ru)} · {formatTimestamp(state.observedAt, ru)}</small></div><span className="network-state-dot" data-state={state.state} /></div><div className="network-metrics"><div className="surface-card"><strong>{ru ? 'Интернет' : 'Internet'}</strong><small>{flag(state.internetAvailable)}</small></div><div className="surface-card"><strong>{ru ? 'Локальная сеть' : 'Local network'}</strong><small>{flag(state.localNetworkAvailable)}</small></div><div className="surface-card"><strong>{ru ? 'Рядом' : 'Nearby'}</strong><small>{flag(state.nearbyAvailable)}</small></div><div className="surface-card"><strong>{ru ? 'Подключения' : 'Connections'}</strong><small>{state.availableProviders.length || (ru ? 'нет' : 'none')}</small></div></div><span className="section-label">{ru ? 'Подключённые способы' : 'Available connections'}</span><div className="media-list">{configuration.providers.length ? configuration.providers.map(provider => <div className="media-row" key={provider.id}><span className="media-row-icon"><Icon name="network" size={15} /></span><span className="media-row-copy"><strong>{provider.id}</strong><small>{provider.type} · {provider.enabled ? (ru ? 'включён' : 'enabled') : (ru ? 'выключен' : 'disabled')}</small></span></div>) : <MediaAdapterEmpty icon="network" title={ru ? 'Подключений нет' : 'No connections yet'} detail={ru ? 'На этом устройстве интернет и локальная сеть пока не настроены.' : 'Internet and local network are not configured on this device yet.'} />}</div></div>;
}

function AgentSurface({ shell, t }: { shell: DesktopShellController; t: Copy }) {
  return <div className="placeholder-surface"><span className="placeholder-icon"><Icon name="bot" size={28} /></span><span className="surface-kicker">{t.agent} · {t.local}</span><h1>{t.agent}</h1><p>{t.home === 'Главная' ? 'Локальный AI пока не подключён. Keystone не отправляет данные во внешние сервисы.' : 'Local AI is not connected yet. Keystone never sends data to external services.'}</p><div className="adapter-note"><span><Icon name="info" size={17} /></span><div><strong>{t.placeholder}</strong><small>{t.agentHint}</small></div></div><button className="secondary-button" onClick={() => shell.openReference({ kind: 'settings', id: 'settings', label: t.settings })}><Icon name="settings" size={14} /> {t.settings}</button></div>;
}

function WorkboardSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  void tab; void shell;
  return <div className="placeholder-surface"><span className="placeholder-icon"><Icon name="board" size={28} /></span><span className="surface-kicker">{t.workboard} · {t.local}</span><h1>{t.workboard}</h1><p>{t.home === 'Главная' ? 'Рабочая доска появится после подключения локального источника.' : 'Workboard will be available after a local source is connected.'}</p><div className="adapter-note"><span><Icon name="info" size={17} /></span><div><strong>{t.placeholder}</strong><small>{t.placeholderBody}</small></div></div></div>;
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
    ? { title: 'Контакты', subtitle: 'Личная адресная книга · локально', search: 'Поиск контактов…', all: 'Все', favorites: 'Избранные', people: 'Люди', organizations: 'Организации', trash: 'Корзина', add: 'Добавить контакт', name: 'Имя', email: 'Электронная почта', create: 'Создать', empty: 'Контактов нет', unavailable: 'Контакты пока недоступны', boundary: 'Подключите локальную адресную книгу. Приватные заметки не показываются в общем списке.', favorite: 'Избранное', identity: 'Связанные профили', noIdentity: 'Явная связь с профилем не добавлена', trashAction: 'В корзину', restore: 'Восстановить', groups: 'Группы', noGroups: 'Групп нет' }
    : { title: 'Contacts', subtitle: 'Personal address book · local', search: 'Search contacts…', all: 'All', favorites: 'Favorites', people: 'People', organizations: 'Organizations', trash: 'Trash', add: 'Add contact', name: 'Name', email: 'Email', create: 'Create', empty: 'No contacts', unavailable: 'Contacts are not available yet', boundary: 'Connect a local address book. Private notes stay out of the shared list.', favorite: 'Favorite', identity: 'Linked profiles', noIdentity: 'No explicit profile link', trashAction: 'Move to trash', restore: 'Restore', groups: 'Groups', noGroups: 'No groups' };
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
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="compass" size={15} /></span><span>{labels.title}</span><span className="surface-badge">{ru ? 'НЕ ПОДКЛЮЧЕНО' : 'NOT CONNECTED'}</span></div><h1>{tab.title || labels.title}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span><Icon name="folder" size={16} /></span><div><strong>{labels.title}</strong><small>{labels.boundary}</small></div></div></div>;
  return <div className="contacts-surface">
    <div className="surface-kicker"><span className="surface-icon"><Icon name="compass" size={15} /></span><span>{labels.title}</span><span className="surface-badge">{labels.subtitle}</span></div>
    <div className="surface-heading"><div><h1>{tab.title === 'Contacts' || tab.title === 'Контакты' ? labels.title : tab.title}</h1><p className="surface-description">{labels.subtitle}</p></div><button className="primary-button" onClick={() => shell.toggleAgentPanel(true)}>{t.agent}</button></div>
    <div className="tasks-toolbar"><div className="tasks-view-switcher">{views.map(([value, label]) => <button key={value} className={view === value ? 'active' : ''} onClick={() => setView(value)}>{label}</button>)}</div><span>{page?.total ?? 0}</span></div>
    <div className="tasks-quick-add"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/></div>
    <form className="contacts-create" onSubmit={create}><input value={newName} onChange={event => setNewName(event.target.value)} placeholder={labels.name} aria-label={labels.name}/><input type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} placeholder={labels.email} aria-label={labels.email}/><button className="primary-button" type="submit">{labels.create}</button></form>
    {notice && <div className="tasks-notice">{notice}</div>}
    <div className="tasks-layout"><main className="tasks-list">{page?.items.length ? page.items.map(contact => <article className={contact.id === selectedId ? 'tasks-row active' : 'tasks-row'} key={contact.id} onClick={() => setSelectedId(contact.id)}><button className="tasks-check" aria-label={labels.favorite} onClick={event => { event.stopPropagation(); void run(() => runtime.favorite(contact.id, !contact.favorite)); }}>{contact.favorite ? '★' : '☆'}</button><div className="tasks-row-copy"><strong>{contact.displayName}</strong><small>{contact.emails[0]?.value ?? contact.phones[0]?.value ?? contact.organization?.name ?? ''}{contact.tags.length ? ` · ${contact.tags.join(', ')}` : ''}</small></div><button className="secondary-button" onClick={event => { event.stopPropagation(); void run(() => view === 'TRASH' ? runtime.restore(contact.id) : runtime.trash(contact.id)); }}>{view === 'TRASH' ? labels.restore : labels.trashAction}</button></article>) : <div className="adapter-note"><span>◎</span><div><strong>{labels.empty}</strong><small>{labels.boundary}</small></div></div>}</main><aside className="tasks-detail">{selected ? <><span className="section-label">{selected.kind === 'ORGANIZATION' ? labels.organizations : labels.people}</span><h2>{selected.displayName}</h2>{selected.organization && <p>{[selected.organization.name, selected.organization.jobTitle, selected.organization.department].filter(Boolean).join(' · ')}</p>}{selected.emails.map(email => <small key={email.id}>{email.label ? `${email.label}: ` : ''}{email.value}</small>)}{selected.phones.map(phone => <small key={phone.id}>{phone.label ? `${phone.label}: ` : ''}{phone.value}</small>)}<span className="section-label">{labels.identity}</span>{selected.linkedIdentityIds.length ? selected.linkedIdentityIds.map(identityId => <small key={identityId}>{identityId}</small>) : <small>{labels.noIdentity}</small>}<span className="section-label">{labels.groups}</span>{selected.groupIds.length ? selected.groupIds.map(groupId => <small key={groupId}>{groups.find(group => group.id === groupId)?.name ?? groupId}</small>) : <small>{labels.noGroups}</small>}</> : <div className="tasks-detail-empty">{labels.empty}</div>}</aside></div>
  </div>;
}

type DesktopTaskView = 'INBOX' | 'TODAY' | 'UPCOMING' | 'ALL' | 'COMPLETED' | 'OVERDUE' | 'SOMEDAY' | 'ASSIGNED_TO_ME' | 'SHARED' | 'TRASH';






function taskDateInputValue(value: DesktopTask['due']): string {
  return value?.value.slice(0, 10) ?? '';
}

function formatTaskDate(value: DesktopTask['due'], locale: Locale): string {
  if (!value) return '';
  const parsed = new Date(value.kind === 'DATE' ? `${value.value}T00:00:00` : value.value);
  if (!Number.isFinite(parsed.valueOf())) return value.value;
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
    ...(value.kind === 'DATETIME' ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(parsed);
}

function TasksSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopTaskRuntime | undefined>(getDesktopTasksRuntime);
  const objectId = tab.object?.id;
  const linkedTaskId = objectId?.startsWith('task:') ? objectId : undefined;
  const [view, setView] = React.useState<DesktopTaskView>(linkedTaskId ? 'ALL' : objectId === 'today' ? 'TODAY' : objectId === 'overdue' ? 'OVERDUE' : 'INBOX');
  const [page, setPage] = React.useState<{ readonly items: readonly DesktopTask[]; readonly total: number }>();
  const [lists, setLists] = React.useState<readonly { readonly id: string; readonly name: string; readonly scope: string; readonly memberCount: number; readonly tombstone: boolean }[]>([]);
  const [listId, setListId] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const requestSequence = React.useRef(0);
  const [quick, setQuick] = React.useState('');
  const [preview, setPreview] = React.useState<ReturnType<DesktopTaskRuntime['previewQuickCapture']>>();
  const [selectedId, setSelectedId] = React.useState(linkedTaskId);
  const [editTitle, setEditTitle] = React.useState('');
  const [editNote, setEditNote] = React.useState('');
  const [editDue, setEditDue] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const ru = t.home === 'Главная';
  const labels = ru
    ? { title: 'Задачи', subtitle: 'Планы, сроки и напоминания сохраняются на этом устройстве.', inbox: 'Входящие', today: 'Сегодня', upcoming: 'Предстоящие', all: 'Все', completed: 'Завершённые', overdue: 'Просроченные', someday: 'Когда-нибудь', shared: 'Общие', trash: 'Корзина', search: 'Поиск по задачам…', add: 'Что нужно сделать?', preview: 'Проверка даты', empty: 'Пока нет задач', unavailable: 'Задачи временно недоступны', boundary: 'Проверьте локальное хранилище и перезапустите Keystone.', complete: 'Отметить выполненной', reopen: 'Вернуть в работу', trashAction: 'Удалить', local: 'Сохранено локально', list: 'список', due: 'Срок', note: 'Заметка', details: 'Детали задачи', name: 'Название', save: 'Сохранить', clear: 'Очистить', filter: 'Показывать', allLists: 'Все списки', reminders: 'Напоминания', noReminders: 'Нет напоминаний', priority: 'Приоритет', low: 'Низкий', medium: 'Средний', high: 'Высокий', ambiguous: 'Дата неоднозначна', choose: 'Выберите задачу слева' }
    : { title: 'Tasks', subtitle: 'Plans, due dates, and reminders stay on this device.', inbox: 'Inbox', today: 'Today', upcoming: 'Upcoming', all: 'All', completed: 'Completed', overdue: 'Overdue', someday: 'Someday', shared: 'Shared', trash: 'Trash', search: 'Search tasks…', add: 'What needs to be done?', preview: 'Date check', empty: 'No tasks yet', unavailable: 'Tasks are temporarily unavailable', boundary: 'Check local storage and restart Keystone.', complete: 'Mark complete', reopen: 'Return to active', trashAction: 'Delete', local: 'Saved locally', list: 'list', due: 'Due', note: 'Note', details: 'Task details', name: 'Title', save: 'Save', clear: 'Clear', filter: 'Show', allLists: 'All lists', reminders: 'Reminders', noReminders: 'No reminders', priority: 'Priority', low: 'Low', medium: 'Medium', high: 'High', ambiguous: 'Ambiguous date', choose: 'Select a task on the left' };
  const refresh = React.useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (!runtime) { setPage(undefined); setLists([]); return; }
    try {
      const [nextPage, nextLists] = await Promise.all([runtime.tasks({ view, query: query.trim() || undefined, ...(listId !== 'all' ? { listId } : {}), includeTrash: view === 'TRASH', limit: 128 }), runtime.lists({ includeTrash: view === 'TRASH' })]);
      const includeLinked = linkedTaskId && view === 'ALL' && listId === 'all' && !query.trim();
      const linked = includeLinked && !nextPage.items.some(task => task.id === linkedTaskId) ? await runtime.task?.(linkedTaskId) : undefined;
      if (sequence !== requestSequence.current) return;
      const items = linked ? [linked, ...nextPage.items] : nextPage.items;
      setPage({ ...nextPage, items });
      setLists(nextLists);
      setSelectedId(current => items.some(task => task.id === current) ? current : includeLinked ? undefined : items[0]?.id);
      setNotice(includeLinked && !items.some(task => task.id === linkedTaskId)
        ? (ru ? 'Эта задача недоступна или находится в корзине.' : 'This task is unavailable or in Trash.')
        : '');
    } catch (error) { if (sequence === requestSequence.current) setNotice(errorText(error, labels.unavailable)); }
  }, [labels.unavailable, linkedTaskId, listId, query, ru, runtime, view]);
  React.useEffect(() => subscribeDesktopTasksRuntime(() => setRuntime(getDesktopTasksRuntime())), []);
  React.useEffect(() => { if (!runtime?.subscribe) return undefined; const unsubscribe = runtime.subscribe(() => void refresh()); return unsubscribe; }, [refresh, runtime]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => { if (!quick.trim() || !runtime) { setPreview(undefined); return; } try { setPreview(runtime.previewQuickCapture(quick, { locale: ru ? 'ru' : 'en' })); } catch { setPreview(undefined); } }, [quick, ru, runtime]);

  const run = async (action: () => Promise<unknown>) => { try { await action(); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : labels.unavailable); } };
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!runtime || !quick.trim()) return;
    try {
      const created = await runtime.quickCapture(quick.trim(), { locale: ru ? 'ru' : 'en' });
      setQuick(''); setPreview(undefined); setSelectedId(created.id); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : labels.unavailable); }
  };
  const selected = page?.items.find(task => task.id === selectedId);
  React.useEffect(() => { setEditTitle(selected?.title ?? ''); setEditNote(selected?.note ?? ''); setEditDue(taskDateInputValue(selected?.due)); }, [selected?.id, selected?.title, selected?.note, selected?.due]);
  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!runtime || !selected || !editTitle.trim()) return;
    await run(() => runtime.update(selected.id, { title: editTitle.trim(), note: editNote.trim() || null, due: editDue.trim() || null }));
  };
  const views: readonly [DesktopTaskView, string][] = [['INBOX', labels.inbox], ['TODAY', labels.today], ['UPCOMING', labels.upcoming], ['ALL', labels.all], ['COMPLETED', labels.completed], ['OVERDUE', labels.overdue], ['SOMEDAY', labels.someday], ['SHARED', labels.shared], ['TRASH', labels.trash]];
  const count = page?.total ?? 0;
  const countLabel = `${count} ${ru ? ruPlural(count, 'задача', 'задачи', 'задач') : count === 1 ? 'task' : 'tasks'}`;
  const priorityLabel = (priority: DesktopTask['priority']): string => priority === 'HIGH' ? labels.high : priority === 'MEDIUM' ? labels.medium : priority === 'LOW' ? labels.low : '';
  // The built-in Inbox is stored with an English name in Core; show it in the UI locale.
  const listLabel = (list: { readonly id: string; readonly name: string }): string => list.id === 'task-list:inbox' ? labels.inbox : list.name;
  const listName = (task: DesktopTask): string => { const list = lists.find(candidate => candidate.id === task.listId); return list ? listLabel(list) : task.listId === 'task-list:inbox' ? labels.inbox : labels.list; };
  const reminderLabel = (reminder: DesktopTask['reminders'][number]): string => reminder.kind === 'AT_DUE' ? labels.due : reminder.kind === 'BEFORE_DUE' ? `${reminder.minutesBefore ?? 0} min` : reminder.at ? formatTaskDate(reminder.at, ru ? 'ru' : 'en') : labels.reminders;
  if (!runtime) return <div className="tasks-unavailable"><span className="surface-icon"><Icon name="task" size={18} /></span><h1>{labels.title}</h1><p>{labels.unavailable}</p><small>{labels.boundary}</small></div>;
  return <div className="tasks-surface">
    <div className="surface-kicker"><span className="surface-icon"><Icon name="task" size={15} /></span><span>{labels.title}</span><span className="surface-badge">{labels.local}</span></div>
    <div className="surface-heading task-manager-heading"><div><h1>{tab.title === 'Tasks' || tab.title === 'Задачи' ? labels.title : tab.title}</h1><p className="surface-description">{labels.subtitle}</p></div></div>
    <div className="task-manager-toolbar">
      <label className="task-filter-control"><Icon name="filter" size={15} /><span>{labels.filter}</span><select value={view} onChange={event => setView(event.target.value as DesktopTaskView)} aria-label={labels.filter}>{views.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {lists.length > 1 && <label className="task-filter-control"><Icon name="list" size={15} /><span>{labels.list}</span><select value={listId} onChange={event => setListId(event.target.value)} aria-label={labels.list}><option value="all">{labels.allLists}</option>{lists.filter(list => !list.tombstone).map(list => <option key={list.id} value={list.id}>{listLabel(list)}</option>)}</select></label>}
      <input className="task-manager-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/><span className="task-manager-count">{countLabel}</span>
    </div>
    <form className="task-manager-add" onSubmit={add}><input autoFocus={objectId === 'new-task'} value={quick} onChange={event => setQuick(event.target.value)} placeholder={labels.add} aria-label={labels.add}/><button className="primary-button" type="submit" aria-label={labels.add}><Icon name="plus" size={15} /><span>{ru ? 'Добавить' : 'Add'}</span></button></form>
    {preview && <div className="task-manager-preview"><span>{labels.preview}</span><strong>{preview.title}</strong>{preview.due && <small>{labels.due}: {formatTaskDate(preview.due, ru ? 'ru' : 'en')}{preview.ambiguous ? ` · ${labels.ambiguous}` : ''}</small>}</div>}
    {notice && <div className="tasks-notice" role="status">{notice}</div>}
    <div className={`task-manager-layout${page?.items.length ? '' : ' is-empty'}`}>
      <section className={`task-manager-list${page?.items.length ? '' : ' is-empty'}`} aria-label={labels.title}>
        {page?.items.length ? page.items.map(task => <article className={`task-manager-row${task.id === selectedId ? ' active' : ''}${task.status === 'COMPLETED' ? ' completed' : ''}`} key={task.id}>
          <button type="button" className="task-manager-check" aria-label={task.status === 'COMPLETED' ? labels.reopen : labels.complete} title={task.status === 'COMPLETED' ? labels.reopen : labels.complete} onClick={event => { event.stopPropagation(); void run(() => task.status === 'COMPLETED' ? runtime.reopen(task.id) : runtime.complete(task.id)); }}><Icon name={task.status === 'COMPLETED' ? 'check-circle' : 'circle'} size={18} /></button>
          <button type="button" className="task-manager-row-copy" aria-pressed={task.id === selectedId} onClick={() => setSelectedId(task.id)}><strong>{task.title}</strong><span className="task-manager-row-meta"><span>{listName(task)}</span>{task.priority !== 'NONE' && <span className={`task-priority priority-${task.priority.toLowerCase()}`}>{labels.priority}: {priorityLabel(task.priority)}</span>}{task.due && <span className="task-due"><Icon name="calendar" size={13} />{formatTaskDate(task.due, ru ? 'ru' : 'en')}</span>}{task.note && <span><Icon name="file-text" size={13} />{labels.note}</span>}{task.tags.length > 0 && <span>{task.tags.join(', ')}</span>}</span></button>
          <button type="button" className="task-manager-row-action" aria-label={view === 'TRASH' ? (ru ? 'Восстановить задачу' : 'Restore task') : labels.trashAction} title={view === 'TRASH' ? (ru ? 'Восстановить' : 'Restore') : labels.trashAction} onClick={event => { event.stopPropagation(); void run(() => view === 'TRASH' ? runtime.restore(task.id) : runtime.trash(task.id)); }}><Icon name={view === 'TRASH' ? 'rotate-ccw' : 'trash'} size={15} /></button>
        </article>) : <div className="task-empty"><span className="task-empty-icon"><Icon name="check" size={18} /></span><strong>{labels.empty}</strong><span>{ru ? 'Добавьте первую задачу в поле выше.' : 'Add your first task in the field above.'}</span></div>}
      </section>
      <aside className="task-manager-detail" aria-label={labels.details}>
        {selected ? <>
          <div className="task-manager-detail-heading"><div><span className="section-label">{labels.details}</span><h2>{selected.title}</h2></div><span className={`task-status task-status-${selected.status.toLowerCase()}`}>{taskStatusLabel(selected.status, ru)}</span></div>
          <div className="task-detail-meta"><span><Icon name="list" size={13} />{listName(selected)}</span>{selected.updatedAt && <time dateTime={selected.updatedAt}>{new Date(selected.updatedAt).toLocaleDateString(ru ? 'ru-RU' : 'en-US')}</time>}</div>
          <form className="task-manager-edit" onSubmit={saveEdit}>
            <label htmlFor="task-manager-title">{labels.name}<input id="task-manager-title" value={editTitle} onChange={event => setEditTitle(event.target.value)} maxLength={4096}/></label>
            <label htmlFor="task-manager-note">{labels.note}<textarea id="task-manager-note" value={editNote} onChange={event => setEditNote(event.target.value)} rows={5} placeholder={ru ? 'Добавьте заметку к задаче' : 'Add a note to this task'} /></label>
            <label htmlFor="task-manager-due">{labels.due}<span className="task-date-control"><input id="task-manager-due" type="date" value={editDue} onChange={event => setEditDue(event.target.value)} />{editDue && <button type="button" className="task-clear-date" onClick={() => setEditDue('')}>{labels.clear}</button>}</span></label>
            <button className="primary-button" type="submit" disabled={!editTitle.trim()}><Icon name="save" size={14} />{labels.save}</button>
          </form>
          <div className="task-manager-detail-actions"><button type="button" className="secondary-button" onClick={() => void run(() => selected.status === 'COMPLETED' ? runtime.reopen(selected.id) : runtime.complete(selected.id))}><Icon name={selected.status === 'COMPLETED' ? 'rotate-ccw' : 'check'} size={14} />{selected.status === 'COMPLETED' ? labels.reopen : labels.complete}</button><button type="button" className="secondary-button task-delete-button" onClick={() => void run(() => runtime.trash(selected.id))}><Icon name="trash" size={14} />{labels.trashAction}</button></div>
          <section className="task-detail-section"><h3>{labels.reminders}</h3>{selected.reminders.length ? selected.reminders.map(reminder => <span className="task-reminder" key={reminder.id}><Icon name="bell" size={13} />{reminderLabel(reminder)}</span>) : <small>{labels.noReminders}</small>}</section>
        </> : <div className="task-detail-empty"><Icon name="list" size={22} /><span>{labels.choose}</span></div>}
      </aside>
    </div>
    <TypedReferenceDock tab={selected ? { ...tab, object: { kind: 'tasks', id: selected.id, label: selected.title } } : tab} shell={shell} t={t} />
  </div>;
}

function CollaborationSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopCollaborationRuntime | undefined>(getDesktopCollaborationRuntime);
  const [objects, setObjects] = React.useState<ReturnType<DesktopCollaborationRuntime['collaboration']['listObjects']>>([]);
  const [selectedId, setSelectedId] = React.useState<string>();
  const ru = t.collaboration.startsWith('Совмест');
  const labels = ru ? { unavailable: 'Совместная работа пока недоступна', boundary: 'Подключите локальное общее пространство. Keystone не создаёт данные за вас.', empty: 'Общих объектов нет', refresh: 'Обновить', participants: 'Участники', invitations: 'Приглашения', pending: 'В очереди', epoch: 'Версия', local: 'Сначала локально' } : { unavailable: 'Shared editing is not available yet', boundary: 'Connect a local shared space. Keystone never invents shared data.', empty: 'No shared objects', refresh: 'Refresh', participants: 'Participants', invitations: 'Invitations', pending: 'Pending', epoch: 'Version', local: 'Local first' };
  const refresh = React.useCallback(() => { if (!runtime) return; const next = runtime.collaboration.listObjects(); setObjects(next); setSelectedId(value => value && next.some(object => object.id === value) ? value : next[0]?.id); }, [runtime]);
  React.useEffect(() => subscribeDesktopCollaborationRuntime(() => setRuntime(getDesktopCollaborationRuntime())), []);
  React.useEffect(() => { refresh(); if (!runtime) return; return runtime.collaboration.subscribe(refresh); }, [refresh, runtime]);
  const selected = objects.find(object => object.id === selectedId);
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="nearby" size={15} /></span><span>{t.collaboration}</span><span className="surface-badge">НЕ ПОДКЛЮЧЕНО</span></div><h1>{tab.title}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{t.collaboration}</strong><small>{labels.boundary}</small></div></div></div>;
  return <div className="object-surface" data-collaboration-surface="true"><div className="surface-kicker"><span className="surface-icon"><Icon name="nearby" size={15} /></span><span>{t.collaboration}</span><span className="surface-badge">{labels.local}</span></div><div className="surface-heading"><div><h1>{tab.title}</h1><p className="surface-description">Yjs state-vector deltas, scoped roles and expiring presence. Presence never enters durable history.</p></div><button className="secondary-button" onClick={refresh}>{labels.refresh}</button></div><div className="surface-grid">{objects.length ? objects.map(object => <button className={`surface-card${object.id === selectedId ? ' active' : ''}`} key={object.id} onClick={() => setSelectedId(object.id)}><strong>{object.kind} · {object.id}</strong><small>{labels.epoch} {object.epoch} · {object.participants.length} {labels.participants} · {object.pendingUpdates} {labels.pending}</small></button>) : <div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{labels.empty}</strong><small>{labels.boundary}</small></div></div>}</div>{selected && <div className="surface-grid"><div className="surface-card"><strong>{labels.participants}</strong>{selected.participants.map(participant => <small key={participant.identityId}>{participant.identityId} · {participant.role} · {participant.status}</small>)}</div><div className="surface-card"><strong>{labels.invitations}</strong>{selected.invitations.length ? selected.invitations.map(invitation => <small key={invitation.id}>{invitation.invitee} · {invitation.role} · {invitation.status}</small>) : <small>{labels.empty}</small>}</div></div>}{selected && <button className="primary-button" onClick={() => shell.setNotice(`${t.collaboration}: ${selected.id}`)}>{t.askAbout}</button>}</div>;
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
  const resumeHint = ru ? 'Типизированные действия ограничены политикой браузера.' : 'Typed intents remain bounded by BrowserPolicy.';
  React.useEffect(() => subscribeDesktopWebLibraryRuntime(() => setWebLibraryRuntime(getDesktopWebLibraryRuntime())), []);
  const savePage = async (mode: 'READER_SNAPSHOT' | 'SAFE_PAGE_ARCHIVE') => { if (!page?.url || !webLibraryRuntime?.captureFromBrowser) { shell.setNotice(ru ? 'Веб-библиотека не подключена.' : 'Web Library is not connected.'); return; } try { await webLibraryRuntime.captureFromBrowser({ url: page.url, title: page.title, mode }); shell.setNotice(ru ? 'Страница сохранена локально.' : 'Page saved locally.'); } catch { shell.setNotice(ru ? 'Не удалось сохранить страницу.' : 'Page could not be saved.'); } };
  return <div className="browser-surface"><div className="browser-toolbar"><span className="browser-lock">⌁</span><code>{page?.url ?? tab.url ?? 'about:blank'}</code><span className="surface-badge">{ru ? 'Защищённый просмотр' : 'Protected view'}</span><span className="surface-badge">{activity}</span></div>{page ? <div className="browser-page-preview"><div className="surface-kicker"><span className="surface-icon"><Icon name="compass" size={15} /></span><span>{pageLabel}</span><span className="surface-badge">{page.dataClass}</span></div><h1>{page.title || pageLabel}</h1><p className="surface-description">{t.browserPrivacy}</p><div className="object-id"><span>{ru ? 'Источник' : 'Source'}</span><code>{page.origin} · {page.pageRevision}</code></div><p className="browser-untrusted">{ru ? 'Непроверенное содержимое страницы' : 'Unverified page content'} · {page.interactiveCount ?? 0} {ru ? 'интерактивных элементов' : 'interactive controls'}</p><div className="surface-grid"><button className="surface-card" onClick={() => void savePage('READER_SNAPSHOT')}><span>▤</span><strong>{ru ? 'Сохранить в просмотрщик' : 'Save to Reader'}</strong><small>{ru ? 'Явное сохранение в веб-библиотеку' : 'Explicit save to Web Library'}</small></button><button className="surface-card" onClick={() => void savePage('SAFE_PAGE_ARCHIVE')}><span>▣</span><strong>{ru ? 'Сохранить офлайн' : 'Save offline'}</strong><small>{ru ? 'Статическая копия без скриптов и форм' : 'Static copy without scripts or forms'}</small></button><button className="surface-card" onClick={() => shell.toggleAgentPanel(true)}><span>✦</span><strong>{t.agent}</strong><small>{t.agentHint}</small></button><button className="surface-card" onClick={() => { shell.setBrowserActivity(tab.id, 'PAUSED', true); shell.setNotice(ru ? 'Автоматические действия приостановлены.' : 'Automatic actions paused.'); }}><span>Ⅱ</span><strong>{takeControl}</strong><small>{manualHint}</small></button><button className="surface-card" onClick={() => { shell.setBrowserActivity(tab.id, 'IDLE', false); shell.setNotice(ru ? 'Автоматические действия могут продолжиться.' : 'Automatic actions may continue.'); }}><span>▶</span><strong>{resumeAgent}</strong><small>{resumeHint}</small></button></div></div> : <div className="browser-empty"><span className="browser-globe">◎</span><h1>{ru ? 'Поверхность браузера' : 'Browser surface'}</h1><p>{t.browserPrivacy}</p><small>{t.placeholder}</small></div>}</div>;
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
    ? { title: 'Подписки', subtitle: 'Локальные RSS, Atom, JSON Feed и подкасты', all: 'Все', unread: 'Непрочитанные', favorites: 'Избранное', podcasts: 'Подкасты', search: 'Поиск по подпискам', add: 'Добавить ссылку', refresh: 'Обновить', read: 'Прочитано', unreadAction: 'Непрочитанное', favorite: 'В избранное', unfavorite: 'Убрать из избранного', open: 'Открыть оригинал', share: 'Поделиться ссылкой', save: 'Сохранить в веб-библиотеку', continue: 'Продолжить на устройстве', download: 'Скачать явно', play: 'Воспроизвести', noReader: 'Выберите элемент', empty: 'Материалов нет', unavailable: 'Подписки пока недоступны', boundary: 'Добавьте локальную ленту. Источники и вложения не открываются без вашего действия.', noFolders: 'Без папки', safe: 'Локальное чтение · без внешних запросов', noRuntime: 'Подписки пока недоступны' }
    : { title: 'Subscriptions', subtitle: 'Local RSS, Atom, JSON Feed and podcasts', all: 'All', unread: 'Unread', favorites: 'Favorites', podcasts: 'Podcasts', search: 'Search subscriptions', add: 'Add link', refresh: 'Refresh', read: 'Read', unreadAction: 'Unread', favorite: 'Favorite', unfavorite: 'Remove favorite', open: 'Open original', share: 'Share link', save: 'Save to Web Library', continue: 'Continue on device', download: 'Download explicitly', play: 'Play', noReader: 'Choose an item', empty: 'No feed items', unavailable: 'Subscriptions are not available yet', boundary: 'Add a local feed. Sources and attachments open only after your action.', noFolders: 'Unfiled', safe: 'Local reader · no external requests', noRuntime: 'Subscriptions are not available yet' };

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

  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="rss" size={15} /></span><span>{t.subscriptions}</span><span className="surface-badge">{t.local}</span></div><h1>{labels.title}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{labels.noRuntime}</strong><small>{labels.boundary}</small></div></div></div>;
  return <div className="subscriptions-surface" data-subscriptions-surface="true"><div className="surface-kicker"><span className="surface-icon"><Icon name="rss" size={15} /></span><span>{t.subscriptions}</span><span className="surface-badge">{t.local}</span></div><div className="surface-heading"><div><h1>{labels.title}</h1><p className="surface-description">{labels.subtitle}</p></div><div className="surface-actions"><button className="secondary-button" onClick={refreshSelected}>{labels.refresh}</button><button className="primary-button" onClick={() => void addSubscription()}>+ {labels.add}</button></div></div><div className="web-library-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/><select value={folderId} onChange={event => setFolderId(event.target.value)} aria-label={labels.noFolders}><option value="">{labels.noFolders}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><span>{entries.length} · {subscriptions.reduce((sum, item) => sum + item.unreadCount, 0)} {labels.unread.toLocaleLowerCase()}</span></div><div className="subscriptions-layout"><aside className="web-library-list"><button className={filter === 'ALL' ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setFilter('ALL')}>{labels.all}</button><button className={filter === 'UNREAD' ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setFilter('UNREAD')}>{labels.unread}</button><button className={filter === 'FAVORITES' ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setFilter('FAVORITES')}>{labels.favorites}</button><button className={filter === 'PODCASTS' ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setFilter('PODCASTS')}>{labels.podcasts}</button><span className="section-label">{labels.title}</span>{subscriptions.map(subscription => <button key={subscription.id} className="web-library-filter" onClick={() => setFolderId('')}>{subscription.title}<small>{subscription.unreadCount} · {subscription.hostname}</small></button>)}<div className="web-library-entry-list">{entries.map(entry => <button key={entry.id} className={entry.id === selectedId ? 'web-library-entry active' : 'web-library-entry'} onClick={() => setSelectedId(entry.id)}><strong>{entry.favorite ? '★ ' : ''}{entry.title}</strong><small>{entry.subscriptionTitle} · {entry.readState === 'READ' ? labels.read : labels.unread}{entry.enclosures.length ? ' · ◉' : ''}</small><span>{entry.author ?? entry.contentText.slice(0, 120)}</span></button>)}{!entries.length && <p className="web-library-empty">{labels.empty}</p>}</div></aside><main className="web-library-reader">{selected && reader ? <><div className="web-library-reader-heading"><div><h2>{reader.entry.title}</h2><p>{reader.entry.subscriptionTitle} · {formatTimestamp(reader.entry.publishedAt ?? reader.entry.firstSeenAt, ru)}</p></div><div className="web-library-reader-actions"><button className="secondary-button" onClick={toggleRead}>{selected.readState === 'READ' ? labels.unreadAction : labels.read}</button><button className="secondary-button" onClick={toggleFavorite}>{selected.favorite ? labels.unfavorite : labels.favorite}</button></div></div><div className="web-library-proof-row"><span>{labels.safe}</span><span>{reader.scriptsExecuted} {ru ? 'скриптов' : 'scripts'}</span><span>{reader.formsSubmitted} {ru ? 'форм' : 'forms'}</span></div><article className="web-library-reader-content" dangerouslySetInnerHTML={{ __html: reader.safeHtml }}/><div className="web-library-reader-footer"><code>{selected.url ?? labels.noReader}</code><div><button className="secondary-button" onClick={openOriginal}>{labels.open}</button><button className="secondary-button" onClick={shareEntry}>{labels.share}</button><button className="secondary-button" onClick={saveArticle}>{labels.save}</button><button className="secondary-button" onClick={continueEntry}>{labels.continue}</button></div></div>{selected.enclosures.length ? <div className="surface-grid">{selected.enclosures.map(enclosure => <div className="surface-card" key={enclosure.id}><strong>{enclosure.title ?? enclosure.mimeType ?? labels.podcasts}</strong><small>{enclosure.download?.state ?? labels.download}</small><div className="surface-actions"><button className="secondary-button" onClick={() => download(enclosure.id)}>{labels.download}</button><button className="secondary-button" disabled={enclosure.download?.state !== 'DOWNLOADED'} onClick={() => play(enclosure.id)}>{labels.play}</button></div></div>)}</div> : null}</> : <div className="web-library-reader-empty"><span>◴</span><p>{labels.noReader}</p></div>}</main></div>{notice && <div className="web-library-notice">{notice}</div>}</div>;
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
    ? { saved: 'Сохранённые страницы', later: 'Прочитать позже', all: 'Все', search: 'Поиск по веб-библиотеке', collections: 'Коллекции', revisions: 'Версии', source: 'Источник', offline: 'Доступно без сети', bookmark: 'Только закладки', partial: 'Сохранено частично', read: 'Прочитано', unread: 'Непрочитано', favorite: 'Избранное', markRead: 'Отметить прочитанным', markUnread: 'Отметить непрочитанным', removeFavorite: 'Убрать из избранного', addFavorite: 'В избранное', note: 'Добавить заметку', highlight: 'Выделить фрагмент', share: 'Поделиться копией', continue: 'Продолжить на устройстве', vault: 'Экспортировать в хранилище', noReader: 'Выберите сохранённый элемент', empty: 'Пока ничего не сохранено', unavailable: 'Библиотека пока недоступна', boundary: 'Добавьте страницу в локальную библиотеку. Архив не открывается без вашего действия.', refresh: 'Обновить' }
    : { saved: 'Saved pages', later: 'Read later', all: 'All', search: 'Search Web Library', collections: 'Collections', revisions: 'Revisions', source: 'Source', offline: 'Available offline', bookmark: 'Bookmarks only', partial: 'Partially saved', read: 'Read', unread: 'Unread', favorite: 'Favorite', markRead: 'Mark read', markUnread: 'Mark unread', removeFavorite: 'Remove favorite', addFavorite: 'Add favorite', note: 'Add note', highlight: 'Highlight', share: 'Share copy', continue: 'Continue on device', vault: 'Export to Vault', noReader: 'Choose a saved item', empty: 'Nothing saved yet', unavailable: 'Web Library is not available yet', boundary: 'Add a page to the local library. The archive opens only after your action.', refresh: 'Refresh' };

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

  if (!runtime) return <div className="web-library-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="book-open" size={15} /></span><span>{t.webLibrary}</span><span className="surface-badge">{t.local}</span></div><h1>{t.webLibrary}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{t.webLibrary}</strong><small>{labels.boundary}</small></div></div></div>;
  return <div className="web-library-surface" data-web-library-id={tab.object?.id ?? tab.id}>
    <div className="surface-kicker"><span className="surface-icon"><Icon name="book-open" size={15} /></span><span>{t.webLibrary}</span><span className="surface-badge">{t.local}</span></div>
    <div className="web-library-heading"><div><h1>{labels.saved}</h1><p className="surface-description">{t.webLibraryDescription}</p></div><div className="web-library-actions"><button className="secondary-button" onClick={() => void refresh()}>{labels.refresh}</button><button className="primary-button" onClick={() => void openBookmark()}>+ {ru ? 'Сохранить URL' : 'Save URL'}</button></div></div>
    <div className="web-library-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/><select value={collectionId} onChange={event => setCollectionId(event.target.value)} aria-label={labels.collections}><option value="">{labels.all}</option>{collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select><span>{entries.length} · {t.local}</span></div>
    <div className="web-library-layout"><aside className="web-library-list"><button className={!collectionId ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setCollectionId('')}>{labels.all}</button><button className={collectionId === 'read-later' ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setCollectionId('read-later')}>{labels.later}</button><span className="section-label">{labels.collections}</span>{collections.map(collection => <button key={collection.id} className={collectionId === collection.id ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setCollectionId(collection.id)}>{collection.name}</button>)}<div className="web-library-entry-list">{entries.map(entry => <button key={entry.id} className={entry.id === selectedId ? 'web-library-entry active' : 'web-library-entry'} onClick={() => setSelectedId(entry.id)}><strong>{entry.favorite ? '★ ' : ''}{entry.title}</strong><small>{entry.kind === 'ARCHIVE' ? labels.offline : labels.bookmark} · {entry.readState === 'READ' ? labels.read : labels.unread}</small><span>{entry.sourceUrl}</span></button>)}{!entries.length && <p className="web-library-empty">{labels.empty}</p>}</div></aside><main className="web-library-reader">{selected && reader ? <><div className="web-library-reader-heading"><div><h2>{reader.entry.title}</h2><p>{reader.revision ? `${labels.offline} · ${reader.revision.title} · ${formatTimestamp(reader.revision.capturedAt, ru)}` : labels.bookmark}</p></div><div className="web-library-reader-actions"><button className="secondary-button" onClick={() => void setRead()}>{selected.readState === 'READ' ? labels.markUnread : labels.markRead}</button><button className="secondary-button" onClick={() => void setFavorite()}>{selected.favorite ? labels.removeFavorite : labels.addFavorite}</button></div></div>{reader.revision ? <><div className="web-library-proof-row"><span>{labels.offline}</span><span>{reader.externalRequestCount} {ru ? 'запросов' : 'requests'}</span><span>{reader.scriptsExecuted} {ru ? 'скриптов' : 'scripts'}</span><span>{reader.formsSubmitted} {ru ? 'форм' : 'forms'}</span><span>{reader.missingResources} {ru ? 'недостающих ресурсов' : 'missing assets'}</span></div><article className="web-library-reader-content"><pre>{reader.text}</pre></article><div className="web-library-reader-footer"><code>{labels.source}: {reader.revision.sourceUrl}</code><div><button className="secondary-button" onClick={() => void highlight()}>{labels.highlight}</button><button className="secondary-button" onClick={() => void addNote()}>{labels.note}</button><button className="secondary-button" onClick={() => void runtime.shareArchive?.(selected.id, reader.revision?.id)}>{labels.share}</button><button className="secondary-button" onClick={() => void runtime.continueOnDevice?.(selected.id, reader.revision?.id)}>{labels.continue}</button><button className="secondary-button" onClick={() => void runtime.exportToVault?.(selected.id, reader.revision?.id)}>{labels.vault}</button></div></div></> : <div className="web-library-bookmark"><p>{labels.bookmark}</p><a href={selected.sourceUrl} target="_blank" rel="noreferrer">{selected.sourceUrl}</a></div>}</> : <div className="web-library-reader-empty"><span>▤</span><p>{labels.noReader}</p></div>}</main></div>{notice && <div className="web-library-notice">{notice}</div>}
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
  const ru = t.continuity.startsWith('Непрерывность устройств');

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

  if (!runtime) return <div className="settings-surface continuity-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="arrow-right" size={15} /></span><span>{t.continuityTitle}</span><span className="surface-badge">{ru ? 'НЕ ПОДКЛЮЧЕНО' : 'NOT CONNECTED'}</span></div><h1>{t.continuityTitle}</h1><p className="surface-description">{t.noContinuityRuntime}</p><div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{t.continuityTitle}</strong><small>{t.handoffBoundary}</small></div></div></div>;
  const trustedDevices = devices.filter(device => !device.isCurrent && device.trustState === 'TRUSTED');
  return <div className="settings-surface continuity-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="arrow-right" size={15} /></span><span>{t.continuityTitle}</span><span className="surface-badge">{t.local}</span></div><div className="continuity-heading"><div><h1>{t.continuityTitle}</h1><p className="surface-description">{t.handoffBoundary}</p></div><button className="secondary-button" onClick={() => void refresh()}>{t.refresh}</button></div>
    <div className="continuity-layout"><section><span className="section-label">{t.chooseDevice}</span><div className="continuity-devices">{trustedDevices.length ? trustedDevices.map(device => <button key={device.deviceId} className={`continuity-device${selectedDevice === device.deviceId ? ' active' : ''}`} onClick={() => setSelectedDevice(device.deviceId)}><span><strong>{device.label}</strong><small>{device.platform} · {availabilityLabel(device)}</small></span><small>{device.capabilities.length} capabilities</small></button>) : <div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{t.noDevices}</strong><small>{t.offline}</small></div></div>}</div><div className="continuity-actions"><button className="primary-button" disabled={!selectedDevice} onClick={() => void sendWorkspace('OPEN')}>{t.sendWorkspace}</button><button className="secondary-button" disabled={!selectedDevice} onClick={() => void sendWorkspace('CONTINUE')}>{t.continueWorkspace}</button><button className="secondary-button" disabled={!selectedDevice} onClick={() => void flush()}>{t.flush}</button></div></section><section className="continuity-policy"><span className="section-label">{t.automaticClipboard}</span><div className="settings-row"><span><strong>{t.automaticClipboard}</strong><small>{t.automaticClipboardWarning}</small></span><SwitchControl checked={automaticClipboard} label={t.automaticClipboard} onChange={checked => void toggleClipboard(checked)} /></div><p>{t.clipboardExplicit}</p></section></div>
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
  if (!runtime) return <div className="settings-surface nearby-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="nearby" size={15} /></span><span>{t.nearbyTitle}</span><span className="surface-badge">{ru ? 'НЕ ПОДКЛЮЧЕНО' : 'NOT CONNECTED'}</span></div><h1>{t.nearbyTitle}</h1><p className="surface-description">{t.nearbyUnavailable}</p><div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{t.nearbyTitle}</strong><small>{t.nearbyBoundary}</small></div></div></div>;
  return <div className="settings-surface nearby-surface" data-nearby-exchange-surface="true">
    <div className="surface-kicker"><span className="surface-icon"><Icon name="nearby" size={15} /></span><span>{t.nearbyTitle}</span><span className="surface-badge">{t.local}</span></div>
    <div className="continuity-heading"><div><h1>{t.nearbyTitle}</h1><p className="surface-description">{t.nearbyBoundary}</p></div><button className="secondary-button" onClick={() => void refresh()}>{t.nearbyRefresh}</button></div>
    <div className="surface-grid"><div className="surface-card"><strong>{t.nearbyReceive}</strong><small>{mode.active ? `${mode.policy}${mode.until ? ` · ${new Date(mode.until).toLocaleTimeString()}` : ''}` : t.nearbyStop}</small><div className="surface-grid"><button className="primary-button" onClick={() => void run(() => runtime.startReceive({ policy: 'ASK_EVERY_TIME' }), t.nearbyReceive)}>{t.nearbyReceive}</button><button className="secondary-button" onClick={() => void run(() => runtime.stopReceive(), t.nearbyStop)}>{t.nearbyStop}</button><button className="secondary-button" onClick={() => void run(async () => setQr(await runtime.createReceiveQr()), t.nearbyShareQr)}>{t.nearbyQr}</button></div></div><div className="surface-card"><strong>{t.nearbyAnonymity}</strong><small>{t.nearbyDisclosure}</small></div></div>
    {qr && <div className="adapter-note"><span>▣</span><div><strong>{t.nearbyQr}</strong><small>{t.nearbyShareQr}</small><code className="nearby-qr-code">{qr}</code></div></div>}
    <span className="section-label">{t.nearbyTitle} · {endpoints.length}</span>
    <div className="surface-grid">{endpoints.length ? endpoints.map(endpoint => <div className="surface-card" key={endpoint.endpointId}><strong>{endpoint.alias}</strong><small>{endpoint.socialState} · {endpoint.capabilities.join(', ')}</small><code>{endpoint.verificationCode}</code><div className="surface-grid"><button className="secondary-button" onClick={() => disclose(endpoint.endpointId)} disabled={!runtime.discloseIdentity}>{t.nearbyDisclosure}</button><button className="secondary-button" onClick={() => addContact(endpoint.endpointId)} disabled={!runtime.addContact}>{t.nearbyAddContact}</button></div></div>) : <div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{t.nearbyNoEndpoints}</strong><small>{t.nearbyAnonymity}</small></div></div>}</div>
    <span className="section-label">{t.nearbyOffers}</span>
    <div className="surface-grid">{offers.filter(offer => offer.direction === 'INCOMING' && offer.status === 'OFFERED').length ? offers.filter(offer => offer.direction === 'INCOMING' && offer.status === 'OFFERED').map(offer => <div className="surface-card" key={offer.offerId}><strong>{offer.title}</strong><small>{offer.objectType}{offer.subtitle ? ` · ${offer.subtitle}` : ''}{offer.byteLength ? ` · ${offer.byteLength} B` : ''}</small><code>{offer.verificationCode}</code><div className="surface-grid"><button className="primary-button" onClick={() => accept(offer.offerId)}>{t.nearbyAccept}</button><button className="secondary-button" onClick={() => reject(offer.offerId)}>{t.nearbyReject}</button></div></div>) : <div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{t.nearbyNoOffers}</strong><small>{t.nearbyDisclosure}</small></div></div>}</div>
    {transfers.length > 0 && <><span className="section-label">{t.nearbyReceived}</span><div className="continuity-list">{transfers.slice(-32).reverse().map(transfer => <div className="continuity-item" key={transfer.transferId}><div className="continuity-item-copy"><strong>{transfer.objectType} · {Math.round(transfer.progress * 100)}%</strong><small>{transfer.status} · {transfer.completedBytes}{transfer.totalBytes ? `/${transfer.totalBytes} B` : ''}</small>{transfer.lastError && <small className="continuity-error">{transfer.lastError}</small>}</div><div className="continuity-item-actions">{['OFFERED', 'ACCEPTED', 'TRANSFERRING'].includes(transfer.status) && <button className="secondary-button" onClick={() => cancel(transfer.transferId)}>{t.nearbyCancel}</button>}{transfer.status === 'PAUSED_WAITING_ROUTE' && <button className="secondary-button" onClick={() => resume(transfer.transferId)}>{t.nearbyResume}</button>}</div></div>)}</div></>}
    {notice && <small className="continuity-notice">{notice}</small>}
  </div>;
}

type DesktopVaultSearchHit = Awaited<ReturnType<DesktopVaultRuntime['search']>>[number] & { readonly vaultId: string };

function SearchSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [query, setQuery] = React.useState(tab.object?.query ?? '');
  const [captureResults, setCaptureResults] = React.useState<Awaited<ReturnType<DesktopCaptureRuntime['search']>>['items']>([]);
  const [taskResults, setTaskResults] = React.useState<Awaited<ReturnType<DesktopTaskRuntime['search']>>['items']>([]);
  const [documentResults, setDocumentResults] = React.useState<Awaited<ReturnType<DesktopDocumentsRuntime['search']>>>([]);
  const [discoveryResults, setDiscoveryResults] = React.useState<Awaited<ReturnType<DesktopDiscoveryRuntime['search']>>['items']>([]);
  const [musicResults, setMusicResults] = React.useState<readonly Extract<import('@keystone/core').MusicObject, { type: 'track' }>[]>([]);
  const [videoResults, setVideoResults] = React.useState<readonly import('@keystone/core').VideoObject[]>([]);
  const [shortResults, setShortResults] = React.useState<readonly import('@keystone/core').ShortVideoObject[]>([]);
  const [fileResults, setFileResults] = React.useState<Awaited<ReturnType<DesktopFilesRuntime['search']>>>([]);
  const [contactResults, setContactResults] = React.useState<Awaited<ReturnType<DesktopContactsRuntime['contacts']>>['items']>([]);
  const [inboxResults, setInboxResults] = React.useState<Awaited<ReturnType<DesktopInboxRuntime['inbox']['search']>>['items']>([]);
  const [webLibraryResults, setWebLibraryResults] = React.useState<Awaited<ReturnType<DesktopWebLibraryRuntime['search']>>>([]);
  const [vaultResults, setVaultResults] = React.useState<readonly DesktopVaultSearchHit[]>([]);
  const [aiResults, setAiResults] = React.useState<DesktopAIConversation[]>([]);
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const ru = t.home === 'Главная';

  const clearResults = () => {
    setCaptureResults([]); setTaskResults([]); setDocumentResults([]); setDiscoveryResults([]);
    setMusicResults([]); setVideoResults([]); setShortResults([]); setFileResults([]);
    setContactResults([]); setInboxResults([]); setWebLibraryResults([]); setVaultResults([]); setAiResults([]);
  };

  const searchRun = React.useRef(0);
  const runSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const value = query.trim();
    const run = ++searchRun.current;
    if (!value) { clearResults(); return; }
    setBusy(true); setNotice('');
    const capture = getDesktopCaptureRuntime();
    const tasks = getDesktopTasksRuntime();
    const documents = getDesktopDocumentsRuntime();
    const discovery = getDesktopDiscoveryRuntime();
    const music = getDesktopMusicRuntime();
    const video = getDesktopVideoRuntime();
    const shorts = getDesktopShortsRuntime();
    const files = getDesktopFilesRuntime();
    const contacts = getDesktopContactsRuntime();
    const inbox = getDesktopInboxRuntime();
    const webLibrary = getDesktopWebLibraryRuntime();
    const vault = getDesktopVaultRuntime();
    const match = (title: string) => title.toLocaleLowerCase().includes(value.toLocaleLowerCase());
    const localAIResult = readDesktopAIConversations(getLocalDesktopProfile()?.ownerIdentityId ?? 'unbound').filter(item => `${item.title} ${item.messages.map(message => message.text).join(' ')}`.toLocaleLowerCase().includes(value.toLocaleLowerCase()));
    const vaultSearch = vault ? vault.listVaults().then(async vaults => {
      const values = await Promise.all(vaults.slice(0, 8).map(async item => {
        const results = await vault.search(item.id, value);
        return results.map(result => ({ ...result, vaultId: item.id }));
      }));
      return values.flat();
    }) : undefined;
    const [captureResult, taskResult, documentResult, discoveryResult, musicResult, videoResult, shortResult, fileResult, contactResult, inboxResult, webLibraryResult, vaultResult] = await Promise.allSettled([
      capture?.search(value, { limit: 32 }),
      tasks?.search(value, { limit: 32 }),
      documents?.search(value, { limit: 32 }),
      discovery?.search(value, { scope: 'local', limit: 32 }),
      music?.music.tracks().then(items => items.filter(item => match(item.payload.title))),
      video?.videos.videos().then(items => items.filter(item => !item.payload.shortForm && match(item.payload.title))),
      shorts?.shorts.list().then(items => items.filter(item => match(item.payload.title))),
      files?.search(value, { limit: 32 }),
      contacts?.search(value, { limit: 32, includePrivateNotes: false }),
      inbox?.inbox.search(value, { limit: 32 }),
      webLibrary?.search(value),
      vaultSearch,
    ]);
    if (run !== searchRun.current) return; // a newer query is already running
    setCaptureResults(captureResult.status === 'fulfilled' ? captureResult.value?.items ?? [] : []);
    setTaskResults(taskResult.status === 'fulfilled' ? taskResult.value?.items ?? [] : []);
    setDocumentResults(documentResult.status === 'fulfilled' ? documentResult.value ?? [] : []);
    setDiscoveryResults(discoveryResult.status === 'fulfilled' ? discoveryResult.value?.items ?? [] : []);
    setMusicResults(musicResult.status === 'fulfilled' ? musicResult.value ?? [] : []);
    setVideoResults(videoResult.status === 'fulfilled' ? videoResult.value ?? [] : []);
    setShortResults(shortResult.status === 'fulfilled' ? shortResult.value ?? [] : []);
    setFileResults(fileResult.status === 'fulfilled' ? fileResult.value ?? [] : []);
    setContactResults(contactResult.status === 'fulfilled' ? contactResult.value?.items ?? [] : []);
    setInboxResults(inboxResult.status === 'fulfilled' ? inboxResult.value?.items ?? [] : []);
    setWebLibraryResults(webLibraryResult.status === 'fulfilled' ? webLibraryResult.value ?? [] : []);
    setVaultResults(vaultResult.status === 'fulfilled' ? vaultResult.value ?? [] : []);
    setAiResults(localAIResult);
    if ([captureResult, taskResult, documentResult, discoveryResult, musicResult, videoResult, shortResult, fileResult, contactResult, inboxResult, webLibraryResult, vaultResult].every(result => result.status === 'rejected')) setNotice(ru ? 'Локальные индексы недоступны.' : 'Local indexes are unavailable.');
    setBusy(false);
  };

  // Search as you type; the short delay keeps fast typing from running every local index per key.
  React.useEffect(() => { const timer = window.setTimeout(() => void runSearch(), 180); return () => window.clearTimeout(timer); }, [query]);
  const total = captureResults.length + taskResults.length + documentResults.length + discoveryResults.length + musicResults.length + videoResults.length + shortResults.length + fileResults.length + contactResults.length + inboxResults.length + webLibraryResults.length + vaultResults.length + aiResults.length;
  return <div className="object-surface search-surface">
    <div className="surface-kicker"><span className="surface-icon"><Icon name="search" size={15} /></span><span>{t.search}</span><span className="surface-badge">{t.local}</span></div>
    <h1>{t.search}</h1>
    <p className="surface-description">{ru ? 'Ищите по локальным захватам, задачам, документам, медиа, файлам, контактам, входящим, архиву и разрешённым объектам.' : 'Search local captures, tasks, documents, media, files, contacts, inbox, archives and permission-aware objects.'}</p>
    <form className="search-form" onSubmit={runSearch}><input value={query} onChange={event => setQuery(event.target.value)} placeholder={ru ? 'Введите текст для поиска…' : 'Search local data…'} aria-label={t.search}/><button className="primary-button" type="submit" disabled={busy || !query.trim()}>{busy ? <Icon name="loader" size={14} /> : <Icon name="search" size={14} />}<span>{t.search}</span></button></form>
    {notice && <p className="maps-notice" role="alert">{notice}</p>}
    {query.trim() && !busy && <p className="search-count" role="status">{total} {ru ? ruPlural(total, 'результат', 'результата', 'результатов') : total === 1 ? 'result' : 'results'}</p>}
    <div className="search-results">
      {captureResults.length > 0 && <section><span className="section-label">{t.capture}</span>{captureResults.map(item => <button type="button" key={item.id} onClick={() => shell.openReference({ kind: 'capture', id: item.id, label: item.title }, { allowDuplicate: true })}><strong>{item.title}</strong><small>{captureStateLabel(item.state, ru)} · {capturePreviewText(item).slice(0, 180)}</small></button>)}</section>}
      {taskResults.length > 0 && <section><span className="section-label">{t.tasks}</span>{taskResults.map(item => <button type="button" key={item.id} onClick={() => shell.openReference({ kind: 'tasks', id: item.id, label: item.title }, { allowDuplicate: true })}><strong>{item.title}</strong><small>{taskStatusLabel(item.status, ru)} · {formatTimestamp(item.updatedAt, ru)}</small></button>)}</section>}
      {documentResults.length > 0 && <section><span className="section-label">{t.documents}</span>{documentResults.map(item => <button type="button" key={`${item.documentId}:${item.locator.page ?? item.locator.chapterId ?? item.snippet}`} onClick={() => shell.openReference({ kind: 'document', id: item.fileId, label: item.title }, { allowDuplicate: true })}><strong>{item.title}</strong><small>{item.format} · {item.snippet}</small></button>)}</section>}
      {musicResults.length > 0 && <section><span className="section-label">{t.music}</span>{musicResults.map(item => <button type="button" key={item.id} onClick={() => shell.openReference({ kind: 'music', id: item.id, label: item.payload.title }, { allowDuplicate: true })}><strong>{item.payload.title}</strong><small>{item.payload.codec} · {formatMediaDuration(item.payload.durationMs)}</small></button>)}</section>}
      {videoResults.length > 0 && <section><span className="section-label">{t.video}</span>{videoResults.map(item => <button type="button" key={item.id} onClick={() => shell.openReference({ kind: 'video', id: item.id, label: item.payload.title }, { allowDuplicate: true })}><strong>{item.payload.title}</strong><small>{item.payload.videoStream.container} · {formatMediaDuration(item.payload.durationMs)}</small></button>)}</section>}
      {shortResults.length > 0 && <section><span className="section-label">{t.shorts}</span>{shortResults.map(item => <button type="button" key={item.id} onClick={() => shell.openReference({ kind: 'shorts', id: item.id, label: item.payload.title }, { allowDuplicate: true })}><strong>{item.payload.title}</strong><small>{item.payload.shortForm?.caption ?? formatMediaDuration(item.payload.durationMs)}</small></button>)}</section>}
      {fileResults.length > 0 && <section><span className="section-label">{t.files}</span>{fileResults.map(item => { const fileId = item.entry.fileId ?? item.entry.childFolderId ?? item.entry.id; return <button type="button" key={item.entry.id} onClick={() => shell.openReference({ kind: 'file', id: fileId, label: item.entry.name }, { allowDuplicate: true })}><strong>{item.entry.name}</strong><small>{item.folder.name} · {item.entry.kind}</small></button>; })}</section>}
      {contactResults.length > 0 && <section><span className="section-label">{t.contacts}</span>{contactResults.map(item => <button type="button" key={item.id} onClick={() => shell.openReference({ kind: 'contacts', id: item.id, label: item.displayName }, { allowDuplicate: true })}><strong>{item.displayName}</strong><small>{item.kind}{item.emails[0] ? ` · ${item.emails[0].value}` : ''}</small></button>)}</section>}
      {inboxResults.length > 0 && <section><span className="section-label">{t.inbox}</span>{inboxResults.map(item => <button type="button" key={item.id} onClick={() => shell.openReference({ kind: 'inbox', id: item.id, label: item.presentation.title }, { allowDuplicate: true })}><strong>{item.presentation.title}</strong><small>{item.presentation.sender ?? item.kind}{item.presentation.snippet ? ` · ${item.presentation.snippet}` : ''}</small></button>)}</section>}
      {webLibraryResults.length > 0 && <section><span className="section-label">{t.webLibrary}</span>{webLibraryResults.map(result => <button type="button" key={result.entry.id} onClick={() => shell.openReference({ kind: 'web-library', id: result.entry.id, label: result.entry.title }, { allowDuplicate: true })}><strong>{result.entry.title}</strong><small>{result.entry.sourceUrl} · {result.snippet}</small></button>)}</section>}
      {vaultResults.length > 0 && <section><span className="section-label">{t.vault}</span>{vaultResults.map(result => <button type="button" key={`${result.vaultId}:${result.note.id}`} onClick={() => shell.openReference({ kind: 'vault', id: result.note.id, vaultId: result.vaultId, label: result.note.title }, { allowDuplicate: true })}><strong>{result.note.title}</strong><small>{result.note.path} · {result.snippet}</small></button>)}</section>}
      {aiResults.length > 0 && <section><span className="section-label">{t.localAI}</span>{aiResults.map(item => <button type="button" key={item.id} onClick={() => shell.openReference({ kind: 'ai', id: item.id, label: item.title }, { allowDuplicate: true })}><strong>{item.title}</strong><small>{item.messages.at(-1)?.text.slice(0, 180) ?? ''}</small></button>)}</section>}
      {discoveryResults.length > 0 && <section><span className="section-label">Discovery</span>{discoveryResults.map(result => <button type="button" key={result.object.id} onClick={() => shell.openReference({ kind: discoveryObjectKind(result.object.type), id: result.object.id, label: discoveryObjectLabel(result.object) }, { allowDuplicate: true })}><strong>{discoveryObjectLabel(result.object)}</strong><small>{result.object.type} · {result.highlights.join(', ') || result.object.author}</small></button>)}</section>}
      {query.trim() && !busy && total === 0 && <div className="adapter-note"><span><Icon name="search" size={17} /></span><div><strong>{ru ? 'Ничего не найдено.' : 'No local matches.'}</strong><small>{ru ? 'Попробуйте другой запрос или сначала создайте локальный объект.' : 'Try another query or create a local object first.'}</small></div></div>}
    </div>
  </div>;
}

function discoveryObjectKind(type: string): DesktopTab['kind'] {
  if (type === 'track' || type === 'artist' || type === 'album' || type === 'playlist') return 'music';
  if (type === 'video') return 'video';
  if (type === 'short_video') return 'shorts';
  if (type === 'identity.profile') return 'profile';
  if (type === 'community') return 'community';
  if (type === 'publication') return 'publication';
  if (type === 'file_object') return 'file';
  if (type === 'live_broadcast') return 'media';
  return 'unknown';
}

function discoveryObjectLabel(object: { readonly id: string; readonly type: string; readonly payload: unknown }): string {
  const payload = object.payload && typeof object.payload === 'object' ? object.payload as Record<string, unknown> : {};
  for (const key of ['title', 'name', 'handle', 'filename']) if (typeof payload[key] === 'string' && payload[key].trim()) return payload[key].trim().slice(0, 120);
  return `${object.type} · ${object.id.slice(0, 12)}`;
}

function DeviceSurface({ t }: { t: Copy }) {
  const profile = getLocalDesktopProfile();
  const ru = t.home === 'Главная';
  if (!profile) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="device" size={15} /></span><span>{ru ? 'Устройство' : 'Device'}</span><span className="surface-badge">{ru ? 'ЛОКАЛЬНО' : 'LOCAL'}</span></div><h1>{ru ? 'Устройство и профиль' : 'Device and profile'}</h1><p className="surface-description">{ru ? 'Локальный профиль ещё не создан.' : 'The local profile has not been created yet.'}</p></div>;
  const rows = [[ru ? 'Владелец' : 'Owner', profile.displayName], [ru ? 'Устройство' : 'Device', profile.deviceName], [ru ? 'Device ID' : 'Device ID', profile.deviceId], [ru ? 'Node ID / public key' : 'Node ID / public key', profile.nodeId], [ru ? 'Encryption public key' : 'Encryption public key', profile.encryptionPublicKey]];
  return <div className="object-surface device-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="device" size={15} /></span><span>{ru ? 'Устройство и профиль' : 'Device and profile'}</span><span className="surface-badge">{ru ? 'ТОЛЬКО НА УСТРОЙСТВЕ' : 'LOCAL ONLY'}</span></div><h1>{profile.deviceName}</h1><p className="surface-description">{ru ? 'Это открытая информация о владельце и устройстве. Секретные ключи не хранятся в интерфейсе.' : 'This is public information about the owner and device. Secret keys are never stored in the interface.'}</p><div className="device-details">{rows.map(([label, value]) => <div key={label}><span>{label}</span><code>{value}</code></div>)}</div><div className="adapter-note"><span><Icon name="shield-check" size={17} /></span><div><strong>{ru ? 'Доверенные устройства не добавлены' : 'No trusted devices added'}</strong><small>{ru ? 'Подключение другого устройства требует отдельного подтверждения.' : 'Adding another device requires a separate confirmation.'}</small></div></div></div>;
}

type SettingsCategory = DesktopSettingCategory | 'capture' | 'documents' | 'network' | 'ai' | 'security' | 'about';

const settingsCategories: ReadonlyArray<{ readonly id: SettingsCategory; readonly icon: IconName; readonly en: string; readonly ru: string; readonly keywords: string }> = [
  { id: 'general', icon: 'settings', en: 'General', ru: 'Основные', keywords: 'startup language locale workspace' },
  { id: 'appearance', icon: 'sun', en: 'Appearance', ru: 'Внешний вид', keywords: 'theme light dark system accent color density typography radius shadow transparency' },
  { id: 'layout', icon: 'layout', en: 'Layout', ru: 'Компоновка', keywords: 'panes activity bar sidebar inspector toolbar status content width' },
  { id: 'navigation', icon: 'sidebar', en: 'Navigation', ru: 'Навигация', keywords: 'activity bar navigation rail workspace' },
  { id: 'home', icon: 'home', en: 'Home', ru: 'Главная', keywords: 'home sections order hidden density empty' },
  { id: 'tabs', icon: 'list', en: 'Tabs', ru: 'Вкладки', keywords: 'tabs style icons close buttons tear off restore' },
  { id: 'sidebars', icon: 'sidebar', en: 'Sidebars', ru: 'Боковые панели', keywords: 'context sidebar inspector position width visibility' },
  { id: 'toolbars', icon: 'settings', en: 'Toolbars', ru: 'Панели инструментов', keywords: 'omnibox breadcrumbs workspace command new status' },
  { id: 'motion', icon: 'activity', en: 'Motion', ru: 'Движение', keywords: 'motion reduced off speed easing animation' },
  { id: 'behavior', icon: 'wrench', en: 'Behavior', ru: 'Поведение', keywords: 'sort filters windows links restore' },
  { id: 'applications', icon: 'grid', en: 'Applications', ru: 'Приложения', keywords: 'adapters surfaces capabilities connected available' },
  { id: 'advanced', icon: 'wrench', en: 'Advanced', ru: 'Расширенные', keywords: 'custom css export import safe mode recovery' },
  { id: 'capture', icon: 'capture', en: 'Capture', ru: 'Захват', keywords: 'quick capture clipboard tray privacy' },
  { id: 'documents', icon: 'document', en: 'Documents', ru: 'Документы', keywords: 'reader pdf epub markdown ocr files' },
  { id: 'network', icon: 'network', en: 'Network', ru: 'Сеть', keywords: 'offline local host adapter connectivity' },
  { id: 'ai', icon: 'bot', en: 'AI', ru: 'AI', keywords: 'agent bot local remote privacy' },
  { id: 'security', icon: 'shield-check', en: 'Privacy & Security', ru: 'Приватность и безопасность', keywords: 'privacy security safety integrity lockdown' },
  { id: 'shortcuts', icon: 'keyboard', en: 'Shortcuts', ru: 'Сочетания клавиш', keywords: 'keyboard command palette omnibox shortcut' },
  { id: 'about', icon: 'info', en: 'About', ru: 'О приложении', keywords: 'version runtime license' },
];

function SettingsSurface({ shell, t, settings, settingsStore, settingsContext, onSettingChange, initialCategory }: { shell: DesktopShellController; t: Copy; settings: DesktopSettingsSnapshot; settingsStore: DesktopSettingsStore; settingsContext: DesktopSettingsContext; onSettingChange: (id: DesktopSettingId, value: unknown, scope?: DesktopSettingScope) => void; initialCategory?: string }) {
  const [safety, setSafety] = React.useState<DesktopSafetyRuntime | undefined>(getDesktopSafetyRuntime);
  const [integrity, setIntegrity] = React.useState<DesktopIntegrityRuntime | undefined>(getDesktopIntegrityRuntime);
  const [aiRuntime, setAiRuntime] = React.useState<DesktopAIRuntime | undefined>(getDesktopAIRuntime);
  const [networkRuntime, setNetworkRuntime] = React.useState<DesktopNetworkRuntime | undefined>(getDesktopNetworkRuntime);
  const [category, setCategory] = React.useState<SettingsCategory>((initialCategory as SettingsCategory) || 'general');
  const [query, setQuery] = React.useState('');
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [importPreview, setImportPreview] = React.useState<DesktopSettingsImportPreview>();
  const [importPayload, setImportPayload] = React.useState<string>();
  const importRef = React.useRef<HTMLInputElement>(null);
  const baselineRef = React.useRef<DesktopSettingsDocument>(settingsStore.snapshot());
  const ru = t.settings.startsWith('Наст');
  const categoryMeta = React.useMemo(() => settingsCategories.map(item => ({ ...item, label: ru ? item.ru : item.en })), [ru]);
  const visibleCategories = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? categoryMeta.filter(item => `${item.label} ${item.en} ${item.ru} ${item.keywords}`.toLocaleLowerCase().includes(normalized)) : categoryMeta;
  }, [categoryMeta, query]);
  React.useEffect(() => {
    if (query.trim() && !visibleCategories.some(item => item.id === category)) setCategory(visibleCategories[0]?.id ?? 'general');
  }, [category, query, visibleCategories]);
  React.useEffect(() => subscribeDesktopSafetyRuntime(() => setSafety(getDesktopSafetyRuntime())), []);
  React.useEffect(() => safety?.subscribe?.(() => setSafety(getDesktopSafetyRuntime())), [safety]);
  React.useEffect(() => subscribeDesktopIntegrityRuntime(() => setIntegrity(getDesktopIntegrityRuntime())), []);
  React.useEffect(() => integrity?.subscribe?.(() => setIntegrity(getDesktopIntegrityRuntime())), [integrity]);
  React.useEffect(() => subscribeDesktopAIRuntime(() => setAiRuntime(getDesktopAIRuntime())), []);
  React.useEffect(() => aiRuntime?.subscribe?.(() => setAiRuntime(getDesktopAIRuntime())), [aiRuntime]);
  React.useEffect(() => subscribeDesktopNetworkRuntime(() => setNetworkRuntime(getDesktopNetworkRuntime())), []);
  React.useEffect(() => networkRuntime?.subscribe?.(() => setNetworkRuntime(getDesktopNetworkRuntime())), [networkRuntime]);

  const preferences: DesktopPreferences = {
    version: 1,
    theme: settings.values['appearance.theme'],
    accent: settings.values['appearance.accent'],
    customAccent: settings.values['appearance.customAccent'],
    density: settings.values['appearance.density'],
    sidebarSize: settings.values['layout.sidebarWidth'] < 240 ? 'narrow' : settings.values['layout.sidebarWidth'] > 330 ? 'wide' : 'default',
    reducedMotion: settings.values['motion.mode'] !== 'full',
    visualEffects: settings.values['appearance.blur'] > 0 || settings.values['appearance.transparency'] > 0 || settings.values['appearance.shadowPreset'] !== 'off',
  };
  const update = (patch: Partial<DesktopPreferences>) => {
    const values: Record<string, unknown> = {};
    if (patch.theme !== undefined) values['appearance.theme'] = patch.theme;
    if (patch.accent !== undefined) values['appearance.accent'] = patch.accent;
    if (patch.customAccent !== undefined) values['appearance.customAccent'] = patch.customAccent;
    if (patch.density !== undefined) values['appearance.density'] = patch.density;
    if (patch.sidebarSize !== undefined) values['layout.sidebarWidth'] = patch.sidebarSize === 'narrow' ? 212 : patch.sidebarSize === 'wide' ? 380 : 280;
    if (patch.reducedMotion !== undefined) values['motion.mode'] = patch.reducedMotion ? 'reduced' : 'full';
    if (patch.visualEffects !== undefined) values['appearance.shadowPreset'] = patch.visualEffects ? 'default' : 'off';
    for (const [id, value] of Object.entries(values)) onSettingChange(id as DesktopSettingId, value);
  };
  const status = safety?.runtime.status();
  const metrics = safety?.runtime.metrics();
  const core = integrity?.core;
  const snapshot = integrity?.snapshot?.() ?? core?.snapshot();
  const locked = snapshot?.locked === true || snapshot?.stage === 'LOCKDOWN';
  const startup = shell.startupSurface().surface;
  const aiPreference = typeof window !== 'undefined' ? window.localStorage.getItem('keystone.local-ai.preference') : null;
  const aiSettings = aiRuntime?.settings.snapshot();
  const networkState = networkRuntime?.snapshot();
  const selectedCategory = categoryMeta.find(item => item.id === category) ?? categoryMeta[0];
  const text = (en: string, ruText: string) => ru ? ruText : en;
  const statusRow = (icon: IconName, title: string, detail: string, value: string, danger = false) => <div className="settings-row settings-status-row"><span className="settings-row-icon"><Icon name={icon} size={16} /></span><span><strong>{title}</strong><small>{detail}</small></span><strong className={danger ? 'settings-danger' : undefined}>{value}</strong></div>;
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) settingsStore.redo(); else settingsStore.undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsStore]);
  const applyPreview = () => { baselineRef.current = settingsStore.snapshot(); shell.setNotice(text('Customization changes applied locally.', 'Изменения оформления применены локально.')); };
  const cancelPreview = () => { settingsStore.restore(baselineRef.current); shell.setNotice(text('Preview reverted.', 'Предпросмотр отменён.')); };
  const resetCategory = () => { const target = category === 'sidebars' || category === 'toolbars' ? 'layout' : category; const result = category === 'appearance' ? settingsStore.resetAllAppearance(settingsContext) : target === 'layout' || target === 'home' || target === 'tabs' ? settingsStore.resetLayout(settingsContext) : settingsStore.resetSection(target as DesktopSettingCategory, 'global', settingsContext); if (!result.ok) shell.setNotice(result.error ?? text('Could not reset this section.', 'Не удалось сбросить раздел.')); };
  const resetWindowAndTabLayout = () => {
    const result = settingsStore.resetLayout(settingsContext);
    if (!result.ok) { shell.setNotice(result.error ?? text('Could not reset the window layout.', 'Не удалось сбросить компоновку окон.')); return; }
    shell.resetWindowAndTabLayout({ preserveTabs: false });
    shell.setNotice(text('Window session reset to one Home tab.', 'Сессия окон сброшена: осталось одно главное окно и вкладка Home.'));
  };
  const exportSettings = () => {
    const blob = new Blob([settingsStore.exportSafe()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'keystone-settings.json'; anchor.click();
    URL.revokeObjectURL(url);
    shell.setNotice(text('Settings exported without secrets.', 'Настройки экспортированы без секретов.'));
  };
  const registryCategories: readonly DesktopSettingCategory[] = ['appearance', 'layout', 'home', 'tabs', 'sidebars', 'toolbars', 'motion', 'shortcuts', 'behavior', 'advanced'];
  const settingScope = (id: DesktopSettingId): DesktopSettingScope => DESKTOP_SETTING_REGISTRY.find(definition => definition.id === id)?.scope ?? 'global';

  const renderCategory = () => {
    if (!selectedCategory) return null;
    if (category === 'general') return <>
      <SettingsSection title={text('Startup', 'Запуск')} description={text('Choose what Keystone restores after a restart.', 'Выберите, что Keystone открывает после перезапуска.')}>
        <div className="settings-row"><span><strong>{text('Startup surface', 'Стартовая поверхность')}</strong><small>{text('The last workspace is restored without sending state anywhere.', 'Последнее рабочее пространство восстанавливается локально.')}</small></span><select value={settings.values['general.startup']} onChange={event => { const next = event.target.value as 'home' | 'last-opened'; onSettingChange('general.startup', next); shell.setStartupSurface(next); }} aria-label={text('Startup surface', 'Стартовая поверхность')}><option value="last-opened">{text('Last opened', 'Последнее открытое')}</option><option value="home">{t.home}</option></select></div>
      </SettingsSection>
      <SettingsSection title={text('Language', 'Язык')} description={text('Change language from the selector in the top bar.', 'Язык меняется селектором в верхней панели.')}>
        {statusRow('globe', text('Interface language', 'Язык интерфейса'), text('Change the language from the top bar.', 'Язык меняется в верхней панели.'), ru ? 'Русский' : 'English')}
      </SettingsSection>
    </>;
    if (registryCategories.includes(category as DesktopSettingCategory)) return <RegistrySettingsPanel category={category as DesktopSettingCategory} shell={shell} t={t} ru={ru} settings={settings} settingsStore={settingsStore} settingsContext={settingsContext} showAdvanced={showAdvanced} onShowAdvanced={setShowAdvanced} onSettingChange={onSettingChange} onReset={id => { const source = settings.sources[id]; if (source !== 'default') settingsStore.reset(id, source, settingsContext); else settingsStore.reset(id, settingScope(id), settingsContext); }} onApplyPreview={applyPreview} onCancelPreview={cancelPreview} onResetCategory={resetCategory} onResetWindowAndTabLayout={resetWindowAndTabLayout} onExport={exportSettings} importPreview={importPreview} setImportPreview={setImportPreview} importPayload={importPayload} setImportPayload={setImportPayload} importRef={importRef} />;
    if (category === 'applications') return <SettingsSection title={text('Applications', 'Приложения')} description={text('Only features available on this device are listed here.', 'Здесь перечислены только возможности, доступные на этом устройстве.')}>
      {[
        [t.capture, Boolean(getDesktopCaptureRuntime())], [t.documents, Boolean(getDesktopDocumentsRuntime())], [t.tasks, Boolean(getDesktopTasksRuntime())], [t.files, Boolean(getDesktopFilesRuntime())], [t.photos, Boolean(getDesktopPhotosRuntime())], [t.music, Boolean(getDesktopMusicRuntime())], [t.video, Boolean(getDesktopVideoRuntime())], [t.webLibrary, Boolean(getDesktopWebLibraryRuntime())], [t.contacts, Boolean(getDesktopContactsRuntime())], [t.inbox, Boolean(getDesktopInboxRuntime())], [t.maps, Boolean(getDesktopMapsRuntime())], [t.calls, Boolean(getDesktopCallsRuntime())], [t.localAI, Boolean(getDesktopAIRuntime())],
      ].map(([label, connected]) => statusRow('check-circle', String(label), text('Available on this device', 'Доступно на этом устройстве'), connected ? text('Ready', 'Готово') : text('Not ready', 'Пока недоступно')))}
    </SettingsSection>;
    if (category === 'appearance') return <>
      <SettingsSection title={text('Theme', 'Тема')} description={text('Use system preference or choose a stable theme for this device.', 'Используйте системную тему или выберите постоянную тему для устройства.')}>
        <div className="settings-segmented" role="radiogroup" aria-label={text('Theme', 'Тема')}>
          {(['system', 'light', 'dark'] as const).map(value => <button type="button" key={value} role="radio" aria-checked={preferences.theme === value} className={preferences.theme === value ? 'selected' : undefined} onClick={() => update({ theme: value })}><Icon name={value === 'system' ? 'monitor' : value === 'light' ? 'sun' : 'moon'} size={15} /><span>{value === 'system' ? text('System', 'Системная') : value === 'light' ? text('Light', 'Светлая') : text('Dark', 'Тёмная')}</span></button>)}
        </div>
      </SettingsSection>
      <SettingsSection title={text('Accent', 'Акцент')} description={text('Accent color is applied to controls and focus states only.', 'Акцент применяется только к элементам управления и фокусу.')}>
        <div className="accent-grid" role="radiogroup" aria-label={text('Accent color', 'Цвет акцента')}>
          {(Object.entries({ ...DESKTOP_ACCENTS, custom: { label: text('Custom', 'Свой') } }) as Array<[DesktopPreferences['accent'], { label: string; value?: string }]>).map(([value, accent]) => <button type="button" key={value} role="radio" aria-checked={preferences.accent === value} className={preferences.accent === value ? 'selected' : undefined} onClick={() => update({ accent: value })}><span className="accent-swatch" style={{ backgroundColor: value === 'custom' ? preferences.customAccent ?? '#e9254d' : accent.value }} /><span>{value === 'custom' ? text('Custom', 'Свой') : accent.label}</span></button>)}
        </div>
        <label className="settings-row settings-input-row"><span><strong>{text('Custom accent', 'Свой акцент')}</strong><small>{text('Use a six-digit hex color.', 'Используйте шестизначный шестнадцатеричный цвет.')}</small></span><input type="color" value={preferences.customAccent ?? '#e9254d'} onChange={event => update({ accent: 'custom', customAccent: event.target.value })} aria-label={text('Custom accent color', 'Свой цвет акцента')} /></label>
      </SettingsSection>
      <SettingsSection title={text('Layout density', 'Плотность интерфейса')} description={text('Compact reduces visual spacing while preserving comfortable click targets.', 'Компактный режим уменьшает визуальные отступы, сохраняя удобные размеры элементов.')}>
        <div className="settings-segmented" role="radiogroup" aria-label={text('Density', 'Плотность')}><button type="button" role="radio" aria-checked={preferences.density === 'comfortable'} className={preferences.density === 'comfortable' ? 'selected' : undefined} onClick={() => update({ density: 'comfortable' })}><Icon name="layout" size={15} />{text('Comfortable', 'Комфортная')}</button><button type="button" role="radio" aria-checked={preferences.density === 'compact'} className={preferences.density === 'compact' ? 'selected' : undefined} onClick={() => update({ density: 'compact' })}><Icon name="list" size={15} />{text('Compact', 'Компактная')}</button></div>
        <div className="settings-segmented" role="radiogroup" aria-label={text('Sidebar width', 'Ширина боковой панели')}><button type="button" role="radio" aria-checked={preferences.sidebarSize === 'narrow'} className={preferences.sidebarSize === 'narrow' ? 'selected' : undefined} onClick={() => update({ sidebarSize: 'narrow' })}>{text('Narrow', 'Узкая')}</button><button type="button" role="radio" aria-checked={preferences.sidebarSize === 'default'} className={preferences.sidebarSize === 'default' ? 'selected' : undefined} onClick={() => update({ sidebarSize: 'default' })}>{text('Default', 'Обычная')}</button><button type="button" role="radio" aria-checked={preferences.sidebarSize === 'wide'} className={preferences.sidebarSize === 'wide' ? 'selected' : undefined} onClick={() => update({ sidebarSize: 'wide' })}>{text('Wide', 'Широкая')}</button></div>
      </SettingsSection>
      <SettingsSection title={text('Motion & effects', 'Движение и эффекты')} description={text('These preferences affect presentation only, not your data.', 'Эти настройки меняют только представление, а не ваши данные.')}>
        <div className="settings-row settings-checkbox"><span><strong>{text('Reduce motion', 'Уменьшить движение')}</strong><small>{text('Respect a calmer interface for vestibular and focus needs.', 'Более спокойный интерфейс для комфорта и концентрации.')}</small></span><SwitchControl checked={preferences.reducedMotion} label={text('Reduce motion', 'Уменьшить движение')} onChange={checked => update({ reducedMotion: checked })} /></div>
        <div className="settings-row settings-checkbox"><span><strong>{text('Visual effects', 'Визуальные эффекты')}</strong><small>{text('Disable decorative blur and elevation when not needed.', 'Отключает декоративный размытие и тени при необходимости.')}</small></span><SwitchControl checked={preferences.visualEffects} label={text('Visual effects', 'Визуальные эффекты')} onChange={checked => update({ visualEffects: checked })} /></div>
      </SettingsSection>
    </>;
    if (category === 'navigation') return <>
      <SettingsSection title={text('Workspace layout', 'Компоновка пространства')} description={text('Keystone keeps navigation, tabs and context in one persistent workspace.', 'Keystone сохраняет навигацию, вкладки и контекст в одном рабочем пространстве.')}>
        <button type="button" className="settings-control-row" onClick={() => shell.toggleContextSidebar()}><span className="settings-row-icon"><Icon name="panel-right" size={16} /></span><span><strong>{t.context}</strong><small>{text('Context is scoped to the active object and stays closed until requested.', 'Контекст ограничен активным объектом и открывается только по запросу.')}</small></span><strong>{shell.chromeState.contextSidebarOpen ? t.show : t.hide}</strong></button>
        <button type="button" className="settings-control-row" onClick={() => shell.toggleAgentPanel()}><span className="settings-row-icon"><Icon name="bot" size={16} /></span><span><strong>{t.agent}</strong><small>{text('The local AI panel appears after a local model is connected.', 'Панель локального AI появится после подключения модели.')}</small></span><strong>{shell.chromeState.agentPanelOpen ? t.show : t.hide}</strong></button>
        <button type="button" className="settings-control-row" onClick={() => shell.openReference({ kind: 'settings', id: 'device', label: ru ? 'Устройство' : 'Device' })}><span className="settings-row-icon"><Icon name="device" size={16} /></span><span><strong>{text('Device and identity', 'Устройство и идентичность')}</strong><small>{text('Inspect the real owner/device metadata projection.', 'Откройте реальные сведения о владельце и устройстве.')}</small></span><strong>{t.open}</strong></button>
      </SettingsSection>
      <SettingsSection title={text('Activity Bar', 'Панель разделов')} description={text('Use the sliders button at the bottom to choose visible sections, pins, and order.', 'Кнопка с ползунками внизу открывает настройку видимых разделов, закрепления и порядка.')}>
        {statusRow('activity', text('Visible sections', 'Видимые разделы'), text('These choices are saved on this device.', 'Эти настройки сохраняются на этом устройстве.'), `${shell.chromeState.activityBar.filter(item => item.visible).length}/${shell.chromeState.activityBar.length}`)}
      </SettingsSection>
    </>;
    if (category === 'capture') return <>
      <SettingsSection title={text('Quick Capture', 'Быстрый захват')} description={text('Capture accepts explicit text, safe links, files, and references.', 'Захват принимает явно выбранный текст, безопасные ссылки, файлы и объекты.')}>
        <button type="button" className="settings-control-row" onClick={() => shell.openReference({ kind: 'capture', id: 'capture', label: t.capture }, { allowDuplicate: true })}><span className="settings-row-icon"><Icon name="capture" size={16} /></span><span><strong>{t.capture}</strong><small>{text('Open your private capture tray.', 'Открыть личную папку захвата.')}</small></span><strong>{t.open}</strong></button>
        {statusRow('copy', text('Clipboard policy', 'Политика буфера обмена'), text('Clipboard is read only after an explicit owner action; no history is retained.', 'Буфер обмена читается только после явного действия владельца; история не хранится.'), text('Explicit only', 'Только явно'))}
      </SettingsSection>
    </>;
    if (category === 'documents') return <>
      <SettingsSection title={text('Documents & Reader', 'Документы и просмотр')} description={text('Reader opens local documents and keeps annotations on this device.', 'Просмотрщик открывает локальные документы и сохраняет аннотации на этом устройстве.')}>
        <button type="button" className="settings-control-row" onClick={() => shell.openReference({ kind: 'document', id: 'documents', label: t.documents }, { allowDuplicate: true })}><span className="settings-row-icon"><Icon name="document" size={16} /></span><span><strong>{t.documents}</strong><small>{text('Open supported PDF, EPUB, Markdown and local OCR surfaces.', 'Открыть PDF, EPUB, Markdown и локальное распознавание.')}</small></span><strong>{t.open}</strong></button>
        {statusRow('file-text', text('Storage', 'Хранение'), text('Files are opened only after you choose them.', 'Файлы открываются только после вашего выбора.'), text('On this device', 'На устройстве'))}
      </SettingsSection>
    </>;
    if (category === 'network') return <>
      <SettingsSection title={text('Connectivity', 'Подключение')} description={text('Keystone remains useful offline. Network features appear after you connect a source.', 'Keystone работает без сети. Сетевые возможности появляются после подключения источника.')}>
        {statusRow('hard-drive', text('Local data', 'Локальные данные'), text('Owner identity, device state and shell preferences are persisted locally.', 'Идентичность владельца, состояние устройства и настройки оболочки сохраняются локально.'), text('Available', 'Доступно'))}
        {statusRow('network', text('Network', 'Сеть'), networkState ? `${networkState.state} · ${networkState.reachability}` : text('Not connected', 'Не подключена'), networkState?.availableProviders.length ? `${networkState.availableProviders.length} ${text('available', 'доступно')}` : text('Device only', 'Только устройство'))}
        <button type="button" className="settings-control-row" onClick={() => shell.openReference({ kind: 'network', id: 'network', label: t.connectivity })}><span className="settings-row-icon"><Icon name="network" size={16} /></span><span><strong>{t.connectivity}</strong><small>{text('See current network status and connections.', 'Посмотреть состояние сети и подключения.')}</small></span><strong>{t.open}</strong></button>
        {statusRow('globe', text('Remote origins', 'Внешние источники'), text('External pages require explicit navigation and never receive Keystone context automatically.', 'Внешние страницы открываются явно и не получают контекст Keystone автоматически.'), text('Explicit only', 'Только явно'))}
      </SettingsSection>
    </>;
    if (category === 'ai') return <>
      <SettingsSection title={text('Local AI', 'Локальный AI')} description={text('Use a local model when you choose to connect one. Private requests stay on this device.', 'Используйте локальную модель после явного подключения. Приватные запросы остаются на устройстве.')}>
        {statusRow('bot', text('Local model', 'Локальная модель'), aiSettings?.models[0]?.displayName ?? text('Not configured', 'Не настроена'), aiSettings?.models[0]?.enabled ? text('Ready', 'Готова') : text('Not ready', 'Не настроена'))}
        {statusRow('privacy', text('External network', 'Внешняя сеть'), text('Private requests are never sent outside the device.', 'Приватные запросы не отправляются за пределы устройства.'), aiSettings?.remoteEnabled === false ? text('Disabled', 'Запрещена') : text('Not used', 'Не используется'))}
        {statusRow('check-circle', text('First-run choice', 'Выбор при запуске'), text('This records whether local AI may be used.', 'Здесь указано, можно ли использовать локальный AI.'), aiPreference === 'enabled' ? text('Allowed', 'Разрешено') : text('Skipped', 'Пропущено'))}
        <button type="button" className="settings-control-row" onClick={() => shell.openReference({ kind: 'ai', id: 'ai', label: t.localAI })}><span className="settings-row-icon"><Icon name="bot" size={16} /></span><span><strong>{t.localAI}</strong><small>{text('Configure Ollama, LM Studio, or an OpenAI-compatible localhost endpoint.', 'Настроить Ollama, LM Studio или локальный endpoint, совместимый с OpenAI API.')}</small></span><strong>{t.open}</strong></button>
      </SettingsSection>
    </>;
    if (category === 'security') return <>
      <SettingsSection title={text('Privacy & security', 'Приватность и безопасность')} description={text('These checks protect local data and sensitive actions.', 'Эти проверки защищают локальные данные и чувствительные действия.')}>
        {statusRow('shield-check', text('Safety checks', 'Проверки безопасности'), `${status ?? text('Not connected', 'Не подключено')} · ${text('policy active', 'политика активна')}`, metrics ? `${metrics.evaluated} / ${metrics.quarantined}` : '—')}
        {statusRow('database', text('App integrity', 'Целостность приложения'), snapshot ? `${snapshot.officialStatus} · ${snapshot.stage}` : text('Not checked', 'Не проверено'), locked ? 'LOCKED' : text('Ready', 'Готово'), locked)}
        {locked && <div className="settings-recovery"><strong>{text('Security-critical files were modified or corrupted', 'Критические файлы изменены или повреждены')}</strong><small>{snapshot?.failure?.category ?? '—'} · {snapshot?.failure?.componentId ?? snapshot?.failure?.path ?? 'core'}</small><div className="settings-actions"><button type="button" onClick={() => void integrity?.verifyAgain?.()}>{text('Verify again', 'Проверить ещё раз')}</button><button type="button" onClick={() => void integrity?.repairHost?.()}>{text('Repair host', 'Восстановить оболочку')}</button><button type="button" onClick={() => void integrity?.verifyRecoveryArtifact?.()}>{text('Verify artifact', 'Проверить артефакт')}</button></div></div>}
      </SettingsSection>
    </>;
    if (category === 'shortcuts') return <SettingsSection title={text('Keyboard shortcuts', 'Сочетания клавиш')} description={text('Shortcuts act on the current pane and never bypass permission checks.', 'Сочетания работают в текущей панели и не обходят проверки разрешений.')}>
      <div className="shortcut-list"><div><span>{text('Command palette', 'Палитра команд')}</span><kbd>{isMac() ? '⌘' : 'Ctrl'} K</kbd></div><div><span>{text('Focus omnibox', 'Фокус поля поиска')}</span><kbd>{isMac() ? '⌘' : 'Ctrl'} L</kbd></div><div><span>{text('Quick Capture', 'Быстрый захват')}</span><kbd>{isMac() ? '⌘' : 'Ctrl'} ⇧ Space</kbd></div><div><span>{text('Close tab', 'Закрыть вкладку')}</span><kbd>{isMac() ? '⌘' : 'Ctrl'} W</kbd></div><div><span>{text('Move between panes', 'Перейти между панелями')}</span><kbd>{isMac() ? '⌘' : 'Ctrl'} 1–9</kbd></div><div><span>{text('Show Keystone window', 'Показать окно Keystone')}</span><span className="shortcut-status"><kbd>Ctrl Alt K</kbd><small>{text('Optional global shortcut; if another app owns it, Keystone continues without it.', 'Необязательная глобальная комбинация; если она занята, Keystone продолжает работать без неё.')}</small></span></div></div>
    </SettingsSection>;
    return <SettingsSection title={text('About Keystone', 'О Keystone')} description={text('This is a local test build of the Keystone desktop app.', 'Это локальная тестовая сборка приложения Keystone.')}>
      {statusRow('keystone', text('Product', 'Продукт'), 'Keystone Desktop', '0.1.0')}
      {statusRow('wrench', text('Platform', 'Платформа'), 'Linux', 'Desktop')}
      {statusRow('privacy', text('Storage', 'Хранение'), text('Your data stays on this device; this view sends no telemetry.', 'Ваши данные остаются на этом устройстве; эта страница не отправляет телеметрию.'), text('Private', 'Приватно'))}
    </SettingsSection>;
  };

  return <div className="settings-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="settings" size={15} /></span><span>{t.settings}</span><span className="surface-badge">{ru ? 'НА УСТРОЙСТВЕ' : 'ON DEVICE'}</span></div><div className="settings-heading"><div><h1>{t.settings}</h1><p className="surface-description">{text('Preferences are stored on this device. Nothing is sent to a network automatically.', 'Настройки сохраняются на этом устройстве. Ничего не отправляется в сеть автоматически.')}</p></div><span className="settings-local-badge"><Icon name="privacy" size={14} /> {t.local}</span></div><div className="settings-layout"><aside className="settings-nav" aria-label={text('Settings categories', 'Категории настроек')}><label className="settings-search"><Icon name="search" size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={text('Search settings', 'Поиск настроек')} aria-label={text('Search settings', 'Поиск настроек')} /></label><nav>{visibleCategories.map(item => <button type="button" key={item.id} className={item.id === category ? 'active' : undefined} onClick={() => setCategory(item.id)}><Icon name={item.icon} size={16} /><span>{item.label}</span></button>)}</nav>{query.trim() && !visibleCategories.length && <p className="settings-no-results">{text('No matching settings.', 'Настройки не найдены.')}</p>}</aside><main className="settings-content" aria-live="polite"><div className="settings-content-heading"><Icon name={selectedCategory?.icon ?? 'settings'} size={20} /><div><span className="section-label">{text('Settings', 'Настройки')}</span><h2>{selectedCategory?.label ?? t.settings}</h2></div></div>{renderCategory()}</main></div></div>;
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="settings-group"><div className="settings-group-heading"><h3>{title}</h3><p>{description}</p></div><div className="settings-group-body">{children}</div></section>;
}

function settingOptionLabel(value: unknown, ru: boolean): string {
  const raw = String(value);
  const labels: Record<string, string> = { 'last-opened': ru ? 'Последняя сессия' : 'Last opened', home: ru ? 'Главная' : 'Home', system: ru ? 'Системная' : 'System', light: ru ? 'Светлая' : 'Light', dark: ru ? 'Тёмная' : 'Dark', rose: ru ? 'Розовая' : 'Rose', blue: ru ? 'Синяя' : 'Blue', violet: ru ? 'Фиолетовая' : 'Violet', amber: ru ? 'Янтарная' : 'Amber', green: ru ? 'Зелёная' : 'Green', custom: ru ? 'Своя' : 'Custom', comfortable: ru ? 'Комфортная' : 'Comfortable', compact: ru ? 'Компактная' : 'Compact', square: ru ? 'Квадратная' : 'Square', subtle: ru ? 'Сдержанная' : 'Subtle', rounded: ru ? 'Округлая' : 'Rounded', off: ru ? 'Выкл.' : 'Off', default: ru ? 'Обычная' : 'Default', strong: ru ? 'Сильная' : 'Strong', full: ru ? 'Полное' : 'Full', reduced: ru ? 'Уменьшенное' : 'Reduced', standard: ru ? 'Обычная' : 'Standard', smooth: ru ? 'Плавная' : 'Smooth', snappy: ru ? 'Быстрая' : 'Snappy', connected: ru ? 'Связанные' : 'Connected', separated: ru ? 'Разделённые' : 'Separated', minimal: ru ? 'Минимальные' : 'Minimal', always: ru ? 'Всегда' : 'Always', hover: ru ? 'При наведении' : 'On hover', active: ru ? 'У активной вкладки' : 'Active tab', none: ru ? 'Нет' : 'None', end: ru ? 'В конце' : 'At end', 'next-to-current': ru ? 'Рядом с текущей' : 'Next to current', 'quick-capture': ru ? 'Быстрый захват' : 'Quick Capture', 'new-document': ru ? 'Новый документ' : 'New document', tasks: ru ? 'Задачи' : 'Tasks', search: ru ? 'Поиск' : 'Search', ai: 'AI', media: ru ? 'Медиа' : 'Media', left: ru ? 'Слева' : 'Left', right: ru ? 'Справа' : 'Right', en: 'English', ru: 'Русский' };
  return labels[raw] ?? raw.replace(/[-_]/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function settingScopeLabel(scope: DesktopSettingScope | 'default', ru: boolean): string {
  const labels: Record<string, string> = { default: ru ? 'По умолчанию' : 'Default', global: ru ? 'Глобально' : 'Global', device: ru ? 'Устройство' : 'Device', workspace: ru ? 'Рабочее пространство' : 'Workspace', surface: ru ? 'Поверхность' : 'Surface', window: ru ? 'Окно' : 'Window', session: ru ? 'Сессия' : 'Session' };
  return labels[scope] ?? scope;
}

function SwitchControl({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <span className="settings-switch"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} aria-label={label} /><span className="settings-switch-track" aria-hidden><span className="settings-switch-thumb" /></span></span>;
}

function SettingControl({ definition, value, ru, onCommit }: { definition: DesktopSettingDefinition; value: unknown; ru: boolean; onCommit: (value: unknown) => void }) {
  const textValue = typeof value === 'string' ? value : '';
  const [draft, setDraft] = React.useState(textValue);
  React.useEffect(() => setDraft(textValue), [textValue]);
  const commitDraft = () => { if (draft !== textValue) onCommit(draft); };
  if (definition.type === 'boolean') return <SwitchControl checked={value === true} onChange={checked => onCommit(checked)} label={ru ? definition.label.ru : definition.label.en} />;
  if (definition.type === 'number') return <div className="settings-range-control"><input type="range" min={definition.min} max={definition.max} step={definition.step} value={typeof value === 'number' ? value : definition.default as number} onChange={event => onCommit(Number(event.target.value))} aria-label={ru ? definition.label.ru : definition.label.en} /><input type="number" min={definition.min} max={definition.max} step={definition.step} value={typeof value === 'number' ? value : definition.default as number} onChange={event => onCommit(Number(event.target.value))} aria-label={ru ? `${definition.label.ru} ${ru ? 'значение' : 'value'}` : `${definition.label.en} value`} /><span>{definition.unit ?? ''}</span></div>;
  if (definition.type === 'enum') return <select value={String(value)} onChange={event => onCommit(event.target.value)} aria-label={ru ? definition.label.ru : definition.label.en}>{(definition.allowedValues ?? []).map(option => <option key={String(option)} value={String(option)}>{settingOptionLabel(option, ru)}</option>)}</select>;
  if (definition.type === 'color') return <input type="color" value={typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#e9254d'} onChange={event => onCommit(event.target.value)} aria-label={ru ? definition.label.ru : definition.label.en} />;
  if (definition.type === 'keybinding') return <input className="settings-keybinding-input" value={draft} placeholder="Ctrl+K" onChange={event => setDraft(event.target.value)} onBlur={commitDraft} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitDraft(); } }} aria-label={ru ? definition.label.ru : definition.label.en} />;
  if (definition.type === 'string') return <input value={draft} onChange={event => setDraft(event.target.value)} onBlur={commitDraft} aria-label={ru ? definition.label.ru : definition.label.en} />;
  return <code className="settings-value-code">{JSON.stringify(value)}</code>;
}

function SettingRow({ definition, value, source, ru, context, onChange, onReset, conflict }: { definition: DesktopSettingDefinition; value: unknown; source: DesktopSettingScope | 'default'; ru: boolean; context: DesktopSettingsContext; onChange: (value: unknown, scope: DesktopSettingScope) => void; onReset: () => void; conflict?: DesktopShortcutConflict }) {
  const options: DesktopSettingScope[] = ['global', ...(context.deviceId ? ['device' as const] : []), ...(context.workspaceId ? ['workspace' as const] : []), ...(context.surfaceId ? ['surface' as const] : []), ...(context.windowId ? ['window' as const] : [])];
  const [scope, setScope] = React.useState<DesktopSettingScope>(options.includes(definition.scope) ? definition.scope : 'global');
  const title = ru ? definition.label.ru : definition.label.en;
  const description = ru ? definition.description.ru : definition.description.en;
  return <div className={`settings-registry-row${conflict ? ' has-shortcut-conflict' : ''}`} data-setting-id={definition.id}><div className="settings-registry-copy"><strong>{title}</strong><small>{description}</small><span className="settings-meta"><code>{definition.id}</code> · {settingScopeLabel(source, ru)}{definition.restartRequirement === 'restart' ? ` · ${ru ? 'требует перезапуска' : 'restart required'}` : ''}</span>{conflict && <span className="settings-conflict" role="alert">{ru ? `Конфликт: ${conflict.ids.length} действия используют ${conflict.shortcut}` : `Conflict: ${conflict.ids.length} actions use ${conflict.shortcut}`}</span>}</div><div className="settings-registry-control"><SettingControl definition={definition} value={value} ru={ru} onCommit={next => onChange(next, scope)} /><select className="settings-scope-select" value={scope} onChange={event => setScope(event.target.value as DesktopSettingScope)} aria-label={ru ? `Область ${title}` : `${title} scope`}>{options.map(option => <option key={option} value={option}>{settingScopeLabel(option, ru)}</option>)}</select>{source !== 'default' && <button type="button" className="quiet-button settings-reset-button" onClick={onReset}>{ru ? 'Сбросить' : 'Reset'}</button>}</div></div>;
}

function ColorTokenEditor({ values, ru, onChange }: { values: DesktopColorOverrides; ru: boolean; onChange: (values: DesktopColorOverrides) => void }) {
  const defaults = desktopThemeColors(typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const labels: Record<keyof DesktopColorOverrides, string> = { background: ru ? 'Фон' : 'Background', surface: ru ? 'Поверхность' : 'Surface', surfaceElevated: ru ? 'Поднятая поверхность' : 'Elevated surface', sidebar: ru ? 'Боковая панель' : 'Sidebar', toolbar: ru ? 'Верхняя панель' : 'Toolbar', tabbar: ru ? 'Панель вкладок' : 'Tab bar', primaryText: ru ? 'Основной текст' : 'Primary text', secondaryText: ru ? 'Вторичный текст' : 'Secondary text', border: ru ? 'Граница' : 'Border', accent: ru ? 'Акцент' : 'Accent', selection: ru ? 'Выделение' : 'Selection', focus: ru ? 'Фокус' : 'Focus', success: ru ? 'Успех' : 'Success', warning: ru ? 'Предупреждение' : 'Warning', danger: ru ? 'Ошибка' : 'Danger' };
  return <div className="settings-color-grid">{(Object.keys(labels) as Array<keyof DesktopColorOverrides>).map(key => <label key={key} className="settings-color-token"><span><strong>{labels[key]}</strong><code>{values[key] ?? defaults[key] ?? ''}</code></span><input type="color" value={values[key] ?? defaults[key] ?? '#000000'} onChange={event => onChange({ ...values, [key]: event.target.value })} aria-label={labels[key]} /></label>)}</div>;
}

function HomeSectionEditor({ settings, ru, onChange }: { settings: DesktopSettingsSnapshot; ru: boolean; onChange: (id: DesktopSettingId, value: unknown, scope?: DesktopSettingScope) => void }) {
  const labels: Record<HomeSectionId, string> = { continue: ru ? 'Продолжить' : 'Continue', today: ru ? 'Сегодня' : 'Today', recent: ru ? 'Недавнее' : 'Recent', pinned: ru ? 'Закреплённое' : 'Pinned' };
  const order = settings.values['home.sectionOrder'];
  const hidden = new Set(settings.values['home.hiddenSections']);
  const move = (index: number, delta: -1 | 1) => { const target = index + delta; if (target < 0 || target >= order.length) return; const next = [...order]; [next[index], next[target]] = [next[target], next[index]]; onChange('home.sectionOrder', next, 'workspace'); };
  return <SettingsSection title={ru ? 'Секции главной' : 'Home sections'} description={ru ? 'Порядок и видимость реальных данных главной сохраняются для текущего рабочего пространства.' : 'Order and visibility of real Home data are persisted for the current workspace.'}><div className="home-section-editor">{order.map((id, index) => <div className="home-section-edit-row" key={id}><span className="drag-handle"><Icon name="ellipsis" size={14} /></span><strong>{labels[id]}</strong><button type="button" className="quiet-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={ru ? 'Вверх' : 'Move up'}><Icon name="arrow-up" size={14} /></button><button type="button" className="quiet-button" onClick={() => move(index, 1)} disabled={index === order.length - 1} aria-label={ru ? 'Вниз' : 'Move down'}><Icon name="arrow-down" size={14} /></button><label className="settings-inline-check"><input type="checkbox" checked={!hidden.has(id)} onChange={event => { const next = new Set(hidden); if (event.target.checked) next.delete(id); else next.add(id); onChange('home.hiddenSections', [...next], 'workspace'); }} /><span>{ru ? 'Видима' : 'Visible'}</span></label></div>)}</div></SettingsSection>;
}

function CustomCssEditor({ settings, settingsStore, settingsContext, ru }: { settings: DesktopSettingsSnapshot; settingsStore: DesktopSettingsStore; settingsContext: DesktopSettingsContext; ru: boolean }) {
  const [draft, setDraft] = React.useState(settings.values['advanced.customCss']);
  const [enabled, setEnabled] = React.useState(settings.document.customCss.enabled);
  const [error, setError] = React.useState('');
  React.useEffect(() => { setDraft(settings.values['advanced.customCss']); setEnabled(settings.document.customCss.enabled); }, [settings.values['advanced.customCss'], settings.document.customCss.enabled]);
  const save = () => { const validation = validateCustomCss(draft); if (!validation.ok) { setError(validation.errors.join(' ')); return; } const result = settingsStore.setCustomCss(draft, enabled); setError(result.ok ? '' : result.error ?? (ru ? 'Не удалось сохранить CSS.' : 'Could not save CSS.')); };
  const safeMode = typeof window !== 'undefined' && window.localStorage.getItem('keystone.desktop.safe-ui-mode') === '1';
  const toggleSafeMode = () => { if (safeMode) window.localStorage.removeItem('keystone.desktop.safe-ui-mode'); else window.localStorage.setItem('keystone.desktop.safe-ui-mode', '1'); window.location.reload(); };
  return <SettingsSection title={ru ? 'Локальный CSS оформления' : 'Local custom CSS'} description={ru ? 'Только CSS для оформления. @import, url(), JavaScript и изменение политики безопасности блокируются.' : 'CSS only for presentation. @import, url(), JavaScript and security-policy changes are rejected.'}><div className="settings-row settings-checkbox"><span><strong>{ru ? 'Включить CSS оформления' : 'Enable custom CSS'}</strong><small>{ru ? 'Стили применяются только к стабильным hooks интерфейса Keystone.' : 'Styles apply only to stable data-keystone-* hooks.'}</small></span><SwitchControl checked={enabled} label={ru ? 'Включить CSS оформления' : 'Enable custom CSS'} onChange={setEnabled} /></div><textarea className="settings-css-editor" value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false} aria-label={ru ? 'CSS оформления' : 'Custom CSS'} placeholder="[data-keystone-region=content] { }" />{error && <p className="settings-error" role="alert">{error}</p>}<div className="settings-actions"><button type="button" className="primary-button" onClick={save}>{ru ? 'Сохранить CSS' : 'Save CSS'}</button><button type="button" className="secondary-button" onClick={() => { setDraft(''); setEnabled(false); const result = settingsStore.setCustomCss('', false); setError(result.ok ? '' : result.error ?? ''); }}>{ru ? 'Очистить' : 'Clear'}</button></div><div className="settings-safe-mode"><Icon name={safeMode ? 'warning' : 'shield-check'} size={16} /><span><strong>{safeMode ? (ru ? 'Безопасный режим интерфейса включён' : 'Safe UI mode is on') : (ru ? 'Безопасный режим интерфейса' : 'Safe UI mode')}</strong><small>{ru ? 'Отключает CSS владельца и возвращает базовое оформление после перезапуска.' : 'Disables owner CSS and restores the base presentation after restart.'}</small></span><button type="button" className="quiet-button" onClick={toggleSafeMode}>{safeMode ? (ru ? 'Выключить' : 'Disable') : (ru ? 'Включить' : 'Enable')}</button></div></SettingsSection>;
}

function RegistrySettingsPanel({ category, shell, t, ru, settings, settingsStore, settingsContext, showAdvanced, onShowAdvanced, onSettingChange, onReset, onApplyPreview, onCancelPreview, onResetCategory, onResetWindowAndTabLayout, onExport, importPreview, setImportPreview, importPayload, setImportPayload, importRef }: { category: DesktopSettingCategory; shell: DesktopShellController; t: Copy; ru: boolean; settings: DesktopSettingsSnapshot; settingsStore: DesktopSettingsStore; settingsContext: DesktopSettingsContext; showAdvanced: boolean; onShowAdvanced: (value: boolean) => void; onSettingChange: (id: DesktopSettingId, value: unknown, scope?: DesktopSettingScope) => void; onReset: (id: DesktopSettingId) => void; onApplyPreview: () => void; onCancelPreview: () => void; onResetCategory: () => void; onResetWindowAndTabLayout: () => void; onExport: () => void; importPreview?: DesktopSettingsImportPreview; setImportPreview: (preview: DesktopSettingsImportPreview | undefined) => void; importPayload?: string; setImportPayload: (payload: string | undefined) => void; importRef: React.RefObject<HTMLInputElement> }) {
  const titleMap: Record<DesktopSettingCategory, string> = { general: ru ? 'Основные' : 'General', appearance: ru ? 'Внешний вид' : 'Appearance', layout: ru ? 'Компоновка' : 'Layout', navigation: ru ? 'Навигация' : 'Navigation', home: ru ? 'Главная' : 'Home', tabs: ru ? 'Вкладки' : 'Tabs', sidebars: ru ? 'Боковые панели' : 'Sidebars', toolbars: ru ? 'Панели инструментов' : 'Toolbars', motion: ru ? 'Движение' : 'Motion', shortcuts: ru ? 'Сочетания клавиш' : 'Shortcuts', behavior: ru ? 'Поведение' : 'Behavior', applications: ru ? 'Приложения' : 'Applications', security: ru ? 'Безопасность' : 'Security', advanced: ru ? 'Расширенные' : 'Advanced' };
  const baseCategory: DesktopSettingCategory = category === 'sidebars' || category === 'toolbars' ? 'layout' : category;
  const definitions = React.useMemo(() => {
    const all = settingsForCategory(baseCategory, showAdvanced);
    if (category === 'sidebars') return all.filter(definition => definition.id.includes('sidebar') || definition.id.includes('inspector'));
    if (category === 'toolbars') return all.filter(definition => definition.id.includes('omnibox') || definition.id.includes('breadcrumbs') || definition.id.includes('workspaceSelector') || definition.id.includes('ButtonVisible') || definition.id.includes('statusBar'));
    return all;
  }, [baseCategory, category, showAdvanced]);
  const shortcutConflictMap = React.useMemo(() => {
    const map = new Map<DesktopSettingId, DesktopShortcutConflict>();
    for (const conflict of findDesktopShortcutConflicts(settings.values)) for (const id of conflict.ids) map.set(id, conflict);
    return map;
  }, [settings.values]);
  const update = (id: DesktopSettingId, value: unknown, scope: DesktopSettingScope) => onSettingChange(id, value, scope);
  const [rawImport, setRawImport] = React.useState(importPayload);
  React.useEffect(() => setRawImport(importPayload), [importPayload]);
  const readImport = (file: File) => { void file.text().then(raw => { setRawImport(raw); setImportPayload(raw); setImportPreview(settingsStore.previewImport(raw)); }); };
  const applyImport = () => { if (!rawImport || !importPreview?.ok) return; const result = settingsStore.importSafe(rawImport, 'merge'); if (!result.ok) setImportPreview(result); else shell.setNotice(ru ? `Импортировано изменений: ${result.changes.length}.` : `Imported ${result.changes.length} changes.`); };
  const presetNames: ReadonlyArray<[DesktopPresetId, string]> = [['keystone-default', ru ? 'Keystone по умолчанию' : 'Keystone default'], ['comfortable', ru ? 'Комфортный' : 'Comfortable'], ['compact', ru ? 'Компактный' : 'Compact'], ['minimal', ru ? 'Минимальный' : 'Minimal']];
  return <div className="settings-registry-panel" data-settings-category={category} data-advanced={showAdvanced ? 'true' : 'false'}><div className="settings-panel-toolbar"><span>{titleMap[category]}</span><div><button type="button" className="quiet-button" onClick={() => settingsStore.undo()}><Icon name="undo" size={14} /> {ru ? 'Отменить' : 'Undo'}</button><button type="button" className="quiet-button" onClick={() => settingsStore.redo()}><Icon name="rotate-ccw" size={14} /> {ru ? 'Повторить' : 'Redo'}</button><button type="button" className="quiet-button" onClick={() => onShowAdvanced(!showAdvanced)}>{showAdvanced ? (ru ? 'Скрыть расширенные' : 'Hide advanced') : (ru ? 'Показать расширенные' : 'Show advanced')}</button></div></div><div className="settings-preview-actions"><button type="button" className="primary-button" onClick={onApplyPreview}>{ru ? 'Применить' : 'Apply'}</button><button type="button" className="secondary-button" onClick={onCancelPreview}>{ru ? 'Отменить предпросмотр' : 'Cancel preview'}</button><button type="button" className="quiet-button" onClick={onResetCategory}>{ru ? 'Сбросить раздел' : 'Reset section'}</button></div>{category === 'appearance' && <SettingsSection title={ru ? 'Пресеты' : 'Presets'} description={ru ? 'Пресет меняет только оформление и компоновку; данные и политика безопасности не затрагиваются.' : 'A preset changes presentation and layout only; core data and security policy are untouched.'}><div className="settings-preset-grid">{presetNames.map(([id, label]) => <button type="button" className="settings-preset" key={id} onClick={() => settingsStore.applyPreset(id, 'global', settingsContext)}><strong>{label}</strong><small>{id === 'keystone-default' ? (ru ? 'Вернуть базовую оболочку' : 'Restore the base shell') : (ru ? 'Готовая стартовая конфигурация' : 'Ready starting configuration')}</small></button>)}</div></SettingsSection>}{category === 'home' && <HomeSectionEditor settings={settings} ru={ru} onChange={onSettingChange} />}{category === 'appearance' && <SettingsSection title={ru ? 'Семантические цвета' : 'Semantic colors'} description={ru ? 'Цвета назначаются по роли, поэтому светлая и тёмная темы не зависят от отдельных компонентов.' : 'Colors are assigned by role so light/dark modes do not depend on individual components.'}><ColorTokenEditor values={settings.values['appearance.colors']} ru={ru} onChange={value => update('appearance.colors', value, 'global')} /></SettingsSection>}{definitions.filter(definition => definition.id !== 'appearance.colors' && definition.id !== 'home.sectionOrder' && definition.id !== 'home.hiddenSections' && definition.id !== 'advanced.customCss' && definition.id !== 'advanced.customCssEnabled').map(definition => <SettingRow key={definition.id} definition={definition} value={settings.values[definition.id]} source={settings.sources[definition.id]} ru={ru} context={settingsContext} onChange={(value, scope) => update(definition.id, value, scope)} conflict={shortcutConflictMap.get(definition.id)} onReset={() => onReset(definition.id)} />)}{category === 'advanced' && <><CustomCssEditor settings={settings} settingsStore={settingsStore} settingsContext={settingsContext} ru={ru} /><SettingsSection title={ru ? 'Перенос настроек' : 'Settings transfer'} description={ru ? 'Экспорт содержит только пользовательские настройки и CSS оформления; идентичность, учётные данные и неизменяемая политика исключены.' : 'Exports contain user settings and custom CSS only; identity, credentials, and immutable policy are excluded.'}><div className="settings-actions"><button type="button" className="secondary-button" onClick={onExport}><Icon name="download" size={14} /> {ru ? 'Экспортировать JSON' : 'Export JSON'}</button><button type="button" className="secondary-button" onClick={() => importRef.current?.click()}><Icon name="upload" size={14} /> {ru ? 'Проверить импорт' : 'Check import'}</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) readImport(file); event.currentTarget.value = ''; }} /></div>{importPreview && <div className={`settings-import-preview${importPreview.ok ? '' : ' invalid'}`}><strong>{importPreview.ok ? (ru ? `Изменений к применению: ${importPreview.changes.length}` : `${importPreview.changes.length} changes ready`) : (ru ? 'Импорт отклонён' : 'Import rejected')}</strong>{importPreview.errors.length > 0 && <small>{importPreview.errors.join(' ')}</small>}{importPreview.ok && <button type="button" className="primary-button" onClick={applyImport}>{ru ? 'Применить импорт' : 'Apply import'}</button>}</div>}</SettingsSection></>}{category === 'layout' && <SettingsSection title={ru ? 'Живая компоновка' : 'Live layout'} description={ru ? 'Эти кнопки управляют реальными панелями текущей оболочки; фиктивные приложения не создаются.' : 'These buttons control the real panels of the current shell; they do not create fake applications.'}><div className="settings-actions"><button type="button" className="secondary-button" onClick={() => shell.toggleContextSidebar()}>{shell.chromeState.contextSidebarOpen ? (ru ? 'Скрыть контекст' : 'Hide Context') : (ru ? 'Показать контекст' : 'Show Context')}</button><button type="button" className="secondary-button" onClick={() => shell.toggleAgentPanel()}>{shell.chromeState.agentPanelOpen ? (ru ? 'Скрыть агента' : 'Show Agent') : (ru ? 'Показать агента' : 'Hide Agent')}</button><button type="button" className="primary-button" onClick={onResetWindowAndTabLayout}><Icon name="rotate-ccw" size={14} /> {ru ? 'Сбросить сессию окон' : 'Reset Window Session'}</button></div><small className="settings-reset-explainer">{ru ? 'Оставит одно главное окно и одну вкладку Home; содержимое владельца не удаляется.' : 'Leaves one main window and one Home tab; owner content is not deleted.'}</small></SettingsSection>}</div>;
}

function SkillsSurface({ shell, t }: { shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopSkillRuntime | undefined>(getDesktopSkillRuntime);
  const [skills, setSkills] = React.useState<readonly { skillId: string; name: string; version: string; enabled: boolean; integrity: string; capabilities: readonly string[] }[]>([]);
  const [candidates, setCandidates] = React.useState<readonly { candidateId: string; title: string; status: string; evidenceCount: number }[]>([]);
  const ru = t.settings.startsWith('Наст');
  React.useEffect(() => subscribeDesktopSkillRuntime(() => setRuntime(getDesktopSkillRuntime())), []);
  const refresh = React.useCallback(() => { if (!runtime) return; void runtime.list().then(setSkills).catch(() => setSkills([])); if (runtime.candidates) void runtime.candidates().then(setCandidates).catch(() => setCandidates([])); }, [runtime]);
  React.useEffect(() => { refresh(); return runtime?.subscribe?.(refresh); }, [refresh, runtime]);
  return <div className="settings-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="spark" size={15} /></span><span>{ru ? 'Skills' : 'Skills'}</span><span className="surface-badge">{t.local}</span></div><h1>{ru ? 'Skills' : 'Skills'}</h1><p className="surface-description">{ru ? 'Дополнительные действия. Разрешения проверяются до запуска.' : 'Additional actions. Permissions are checked before they run.'}</p>{runtime ? <><div className="settings-list">{skills.map(skill => <div key={skill.skillId} className="settings-row"><span><strong>{skill.name}</strong><small>{skill.enabled ? (ru ? 'Включено' : 'Enabled') : (ru ? 'Выключено' : 'Disabled')}</small></span><button className="secondary-button" onClick={() => { if (skill.enabled) void runtime.disable?.(skill.skillId).then(refresh); else void runtime.enable?.(skill.skillId).then(refresh); }}>{skill.enabled ? (ru ? 'Отключить' : 'Disable') : (ru ? 'Включить' : 'Enable')}</button></div>)}</div><h2>{ru ? 'Кандидаты' : 'Candidates'}</h2><div className="settings-list">{candidates.map(candidate => <div key={candidate.candidateId} className="settings-row"><span><strong>{candidate.title}</strong><small>{candidate.evidenceCount} {ru ? 'подтверждений' : 'successful runs'}</small></span><button className="secondary-button" onClick={() => shell.setNotice(ru ? 'Кандидат требует явной проверки.' : 'Candidate requires explicit review.')}>{ru ? 'Проверить' : 'Review'}</button></div>)}</div></> : <div className="placeholder-surface"><span className="placeholder-icon"><Icon name="spark" size={22} /></span><h2>{ru ? 'Дополнительные действия недоступны' : 'Additional actions are unavailable'}</h2><p>{ru ? 'Попробуйте снова после подключения локального источника.' : 'Try again after connecting a local source.'}</p></div>}</div>;
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
  const labels = ru ? { unavailable: 'Хранилище пока недоступно', boundary: 'Подключите локальное хранилище в настройках. Keystone не читает файлы без вашего действия.', notes: 'Заметки', search: 'Поиск по хранилищу', create: 'Новая заметка', folder: 'Новая папка', save: 'Сохранить', rename: 'Переименовать', remove: 'Удалить', links: 'Обратные ссылки', outline: 'Структура', properties: 'Свойства', empty: 'Выберите заметку', saved: 'Сохранено локально', readonly: 'Только чтение: локальное хранилище не подключено', source: 'Источник', preview: 'Предпросмотр', graph: 'Локальный граф' } : { unavailable: 'Storage is not connected', boundary: 'Connect local storage in Settings. Keystone never reads files without your action.', notes: 'Notes', search: 'Search storage', create: 'New note', folder: 'New folder', save: 'Save', rename: 'Rename', remove: 'Delete', links: 'Backlinks', outline: 'Outline', properties: 'Properties', empty: 'Select a note', saved: 'Saved locally', readonly: 'Read-only: local storage is not connected', source: 'Source', preview: 'Preview', graph: 'Local graph' };
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
    <div className="surface-kicker"><span className="surface-icon"><Icon name="vault" size={15} /></span><span>{t.vault}</span><span className="surface-badge">{t.local}</span></div>
    <div className="vault-heading"><div><h1>{vaults.find(value => value.id === vaultId)?.name ?? tab.title}</h1><p className="surface-description">{runtime ? `${notes.length} ${labels.notes} · ${t.privacy}` : labels.unavailable}</p></div><div className="vault-actions"><button className="secondary-button" onClick={() => note && shell.openReference({ kind: 'graph', id: note.id, vaultId, label: labels.graph })} disabled={!note}>{labels.graph}</button><button className="secondary-button" onClick={() => void createFolder()}>{labels.folder}</button><button className="secondary-button" onClick={() => void create()}>{labels.create}</button><button className="primary-button" onClick={() => void save()} disabled={!note}>{labels.save}</button></div></div>
    {!runtime && <div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{labels.unavailable}</strong><small>{labels.boundary}</small></div></div>}
    <div className="vault-layout"><aside className="vault-tree"><label className="section-label">{labels.search}<input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search}/></label>{query && <div className="vault-search-results">{results.map(result => <button key={result.note.id} onClick={() => void choose(result.note.id)}><strong>{result.note.title}</strong><small>{result.note.path}</small><span>{result.snippet}</span></button>)}</div>}<span className="section-label">{labels.notes}</span><div className="vault-note-list">{notes.map(value => <button key={value.id} className={value.id === selectedId ? 'active' : ''} onClick={() => void choose(value.id)}><strong>{value.title}</strong><small>{value.path}</small></button>)}</div></aside><main className="vault-editor">{note ? <><div className="vault-editor-toolbar"><span>{note.path} · r{note.revision}</span><div><button className="secondary-button" onClick={() => setShowPreview(value => !value)}>{showPreview ? labels.source : labels.preview}</button><button className="secondary-button" onClick={() => void rename()}>{labels.rename}</button><button className="secondary-button danger" onClick={() => void remove()}>{labels.remove}</button></div></div>{showPreview ? <div className="vault-preview" aria-label={labels.preview}><InlineKeystoneLinks text={preview ?? draft} shell={shell}/></div> : <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); const start = event.currentTarget.selectionStart; const end = event.currentTarget.selectionEnd; setDraft(`${draft.slice(0, start)}**${draft.slice(start, end)}**${draft.slice(end)}`); } else if (event.key === 'Tab') { event.preventDefault(); const start = event.currentTarget.selectionStart; setDraft(`${draft.slice(0, start)}  ${draft.slice(event.currentTarget.selectionEnd)}`); } }} aria-label={note.title} spellCheck={false}/>}<small className="untrusted-note">UNTRUSTED MARKDOWN · {labels.source}</small>{notice && <small className="vault-notice">{notice}</small>}</> : <div className="vault-empty"><span>▱</span><p>{runtime ? labels.empty : labels.readonly}</p></div>}</main><aside className="vault-inspector"><span className="section-label">{labels.outline}</span>{note?.headings.map(heading => <div key={`${heading.id}-${heading.line}`} className={`vault-heading-level-${heading.level}`}>{heading.text}</div>)}<span className="section-label">{labels.links}</span>{backlinks.map(link => <button key={`${link.sourceNoteId}-${link.sourcePath}`} onClick={() => void choose(link.sourceNoteId)}>{link.sourcePath}</button>)}<span className="section-label">{labels.properties}</span>{note && Object.entries(note.properties).map(([key, value]) => <div className="vault-property" key={key}><strong>{key}</strong><span>{Array.isArray(value.value) ? value.value.join(', ') : String(value.value)}</span></div>)}</aside></div>
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
  const labels = ru ? { title: 'Граф хранилища', local: 'Локальный граф', global: 'Общий граф', search: 'Фильтр по графу', depth: 'Глубина', unresolved: 'Неразрешённые', open: 'Открыть', orphans: 'Без связей', empty: 'Граф пока недоступен', boundary: 'Подключите локальное хранилище в настройках. Граф строится по связанным заметкам.', nodes: 'узлов', edges: 'связей', truncated: 'Показ ограничен размером области.' } : { title: 'Storage graph', local: 'Local graph', global: 'Shared graph', search: 'Filter graph', depth: 'Depth', unresolved: 'Unresolved', open: 'Open', orphans: 'Orphans', empty: 'Graph is not available', boundary: 'Connect local storage in Settings. The graph is built from linked notes.', nodes: 'nodes', edges: 'edges', truncated: 'The displayed area limits this view.' };
  React.useEffect(() => subscribeDesktopVaultRuntime(() => setRuntime(getDesktopVaultRuntime())), []);
  const refresh = React.useCallback(async () => { if (!runtime?.graph || !vaultId) return; try { const next = local && runtime.graph.local && tab.object?.id && tab.object.id !== 'local' ? await runtime.graph.local(vaultId, tab.object.id, depth) : await runtime.graph.global(vaultId, { text: query || undefined, depth, limitNodes: 240, limitEdges: 480, includeUnresolved }); setProjection(next); setNotice(''); } catch { setNotice(labels.empty); } }, [depth, includeUnresolved, labels.empty, local, query, runtime, tab.object?.id, vaultId]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const openNode = (node: DesktopVaultGraphProjection['nodes'][number]) => { if (node.kind === 'NOTE' && !node.unresolved) shell.openReference({ kind: 'vault', id: node.id, vaultId, label: node.label }); else if (node.kind === 'ATTACHMENT') shell.openReference({ kind: 'file', id: node.id, vaultId, label: node.label }); else setNotice(node.unresolved ? `${labels.unresolved}: ${node.label}` : node.label); };
  const orphans = projection?.orphanNodeIds.length ?? 0;
  return <div className="vault-graph-surface" data-vault-id={vaultId || tab.id}>
    <div className="surface-kicker"><span className="surface-icon"><Icon name="graph" size={15} /></span><span>{local ? labels.local : labels.title}</span><span className="surface-badge">{t.local}</span></div>
    <div className="graph-heading"><div><h1>{local ? labels.local : labels.title}</h1><p className="surface-description">{runtime?.graph ? `${projection?.nodes.length ?? 0} ${labels.nodes} · ${projection?.edges.length ?? 0} ${labels.edges}` : labels.empty}</p></div><div className="graph-actions"><button className={local ? 'secondary-button' : 'primary-button'} onClick={() => setLocal(false)}>{labels.global}</button><button className={!local ? 'secondary-button' : 'primary-button'} onClick={() => setLocal(true)}>{labels.local}</button><button className="secondary-button" onClick={() => setNotice(`${labels.orphans}: ${orphans}`)}>{labels.orphans} · {orphans}</button></div></div>
    {!runtime?.graph && <div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{labels.empty}</strong><small>{labels.boundary}</small></div></div>}
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
  const labels = ru ? { title: 'Canvas', empty: 'Среда Canvas ещё не подключена', boundary: 'Подключите CanvasService через типизированный адаптер хранилища и разрешений. Документ остаётся структурированным JSON.', create: 'Новый Canvas', nodes: 'карточек', addText: 'Добавить текст', move: 'Сдвинуть', connect: 'Соединить', undo: 'Отменить', redo: 'Повторить', select: 'Выберите карточки', open: 'Открыть источник', permission: 'Ссылка недоступна по текущим разрешениям', saved: 'Canvas сохранён' } : { title: 'Canvas', empty: 'Canvas host is not connected', boundary: 'Install CanvasService through the typed storage/permission adapter. The document remains structured JSON.', create: 'New Canvas', nodes: 'cards', addText: 'Add text', move: 'Move', connect: 'Connect', undo: 'Undo', redo: 'Redo', select: 'Select cards', open: 'Open source', permission: 'Reference is unavailable under current permissions', saved: 'Canvas saved' };
  React.useEffect(() => subscribeDesktopVaultRuntime(() => setRuntime(getDesktopVaultRuntime())), []);
  const refresh = React.useCallback(async () => { if (!runtime?.canvas) return; try { const next = await runtime.canvas.list(vaultId); setCanvases(next); const id = canvasId && next.some(value => value.id === canvasId) ? canvasId : next[0]?.id; if (id) setDocument(await runtime.canvas.open(vaultId, id)); } catch { setNotice(labels.empty); } }, [canvasId, labels.empty, runtime, vaultId]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const choose = async (id: string) => { if (!runtime?.canvas) return; const next = await runtime.canvas.open(vaultId, id); setDocument(next); setSelected([]); };
  const create = async () => { if (!runtime?.canvas?.create) { setNotice(labels.empty); return; } const next = await runtime.canvas.create(vaultId, labels.title); setDocument(next); setCanvases(await runtime.canvas.list(vaultId)); };
  const mutate = async (mutation: unknown) => { if (!runtime?.canvas?.mutate || !document) { setNotice(labels.empty); return; } try { setDocument(await runtime.canvas.mutate(vaultId, document.id, mutation)); setNotice(labels.saved); } catch { setNotice(labels.permission); } };
  const openSelected = () => { const node = document?.nodes.find(value => selected.includes(value.id)); const ref = node?.reference; if (!ref) { setNotice(labels.permission); return; } const objectId = typeof ref.objectId === 'string' ? ref.objectId : typeof ref.noteId === 'string' ? ref.noteId : typeof ref.attachmentId === 'string' ? ref.attachmentId : undefined; if (objectId) shell.openReference({ kind: ref.kind === 'vault_note' || ref.kind === 'note' ? 'vault' : ref.kind === 'vault_attachment' || ref.kind === 'file' ? 'file' : 'unknown', id: objectId, vaultId }); else setNotice(labels.permission); };
  return <div className="vault-canvas-surface" data-canvas-id={document?.id ?? canvasId}>
    <div className="surface-kicker"><span className="surface-icon"><Icon name="canvas" size={15} /></span><span>{labels.title}</span><span className="surface-badge">{t.local}</span></div>
    <div className="canvas-heading"><div><h1>{document?.metadata.title ?? labels.title}</h1><p className="surface-description">{document ? `${document.nodes.length} ${labels.nodes} · r${document.revision}` : labels.empty}</p></div><div className="canvas-actions"><button className="secondary-button" onClick={() => void create()}>{labels.create}</button><button className="secondary-button" onClick={() => { if (document && runtime?.canvas?.undo) void runtime.canvas.undo(vaultId, document.id).then(setDocument); }}>{labels.undo}</button><button className="secondary-button" onClick={() => { if (document && runtime?.canvas?.redo) void runtime.canvas.redo(vaultId, document.id).then(setDocument); }}>{labels.redo}</button></div></div>
    {!runtime?.canvas && <div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{labels.empty}</strong><small>{labels.boundary}</small></div></div>}
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
    subtitle: 'Места и маршруты сначала работают локально. Геопозиция не запрашивается автоматически.', unavailable: 'Карты пока не подключены', boundary: 'Подключите карты в настройках. Keystone не получает координаты без вашего действия.', search: 'Найти место', searchPlaceholder: 'Название, адрес или категория', showLocation: 'Показать мою геопозицию', locationDone: 'Геопозиция показана однократно', locationUnavailable: 'Одноразовая геопозиция недоступна', results: 'Результаты', saved: 'Сохранённые места', providers: 'Источники', offline: 'Офлайн-пакеты', route: 'Маршрут', from: 'Откуда', to: 'Куда', mode: 'Режим', walking: 'Пешком', driving: 'Авто', cycling: 'Велосипед', plan: 'Построить маршрут', noResults: 'Ничего не найдено локально.', noSaved: 'Сохранённых мест нет.', noOffline: 'Офлайн-пакетов нет.', providerBoundary: 'Внешние источники включаются только после явного разрешения.', oneShot: 'Только один запрос · без истории перемещений', estimated: 'Оценочный маршрут', steps: 'Шаги', km: 'км', min: 'мин', noRoute: 'Маршрут пока недоступен.'
  } : {
    subtitle: 'Places and routes work locally first. Location is never requested automatically.', unavailable: 'Maps are not connected', boundary: 'Connect Maps in Settings. Keystone never receives coordinates without your action.', search: 'Search places', searchPlaceholder: 'Name, address or category', showLocation: 'Show my location', locationDone: 'Location shown once', locationUnavailable: 'One-shot location is unavailable', results: 'Results', saved: 'Saved places', providers: 'Sources', offline: 'Offline packages', route: 'Route', from: 'From', to: 'To', mode: 'Mode', walking: 'Walking', driving: 'Driving', cycling: 'Cycling', plan: 'Plan route', noResults: 'No local results.', noSaved: 'No saved places.', noOffline: 'No offline packages.', providerBoundary: 'External sources are enabled only after explicit permission.', oneShot: 'One request only · no movement history', estimated: 'Estimated route', steps: 'Steps', km: 'km', min: 'min', noRoute: 'Routing is not available yet.'
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
  const mapLayerLabel = (value: string | undefined) => {
    if (!ru) return value ?? 'SCHEMATIC';
    return value === 'SCHEMATIC' ? 'Схема' : value ?? 'Схема';
  };
  const mapPrecisionLabel = locationPrecision === 'PRECISE' ? (ru ? 'Точная' : 'PRECISE') : locationPrecision === 'APPROXIMATE' ? (ru ? 'Приблизительная' : 'APPROXIMATE') : '';
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="map" size={15} /></span><span>{t.maps}</span><span className="surface-badge">{ru ? 'ЛОКАЛЬНЫЙ АДАПТЕР' : 'HOST ADAPTER'}</span></div><h1>{t.maps}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{t.maps}</strong><small>{labels.boundary}</small></div></div></div>;

  return <div className="maps-surface" data-map-tab={tab.object?.id ?? tab.id}>
    <div className="surface-kicker"><span className="surface-icon"><Icon name="map" size={15} /></span><span>{t.maps}</span><span className="surface-badge">{state?.location ?? (ru ? 'УСТРОЙСТВО' : 'HOST')}</span></div>
    <div className="maps-heading"><div><h1>{tab.title}</h1><p className="surface-description">{labels.subtitle}</p></div><button className="secondary-button" onClick={() => void showLocation()}>⌖ {labels.showLocation}</button></div>
    <div className="maps-toolbar"><form className="maps-search" onSubmit={search}><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.searchPlaceholder} aria-label={labels.searchPlaceholder}/><button className="primary-button" disabled={!query.trim()}>{labels.search}</button></form>{locationPrecision && <span className="maps-location-state">{mapPrecisionLabel} · {labels.oneShot}</span>}</div>
    <div className="maps-layout">
      <main className="maps-main">
        <section className="maps-canvas" aria-label={t.maps}>
          <div className="maps-grid" aria-hidden="true"/><div className="maps-road maps-road-one" aria-hidden="true"/><div className="maps-road maps-road-two" aria-hidden="true"/>
          <span className="maps-canvas-center">{center ? `${center.latitude.toFixed(3)}, ${center.longitude.toFixed(3)}` : '—'}</span>
          {render?.features.slice(0, 40).map((feature, index) => <span className="maps-feature" key={feature.id} style={{ left: `${12 + (index * 17) % 76}%`, top: `${18 + (index * 29) % 62}%` }} title={feature.label ?? feature.kind}>•</span>)}
          <div className="maps-canvas-footer"><span>{mapLayerLabel(render?.layer)} · {render?.offline ? (ru ? 'Офлайн' : 'OFFLINE') : (render?.providerId ?? (ru ? 'Локально' : 'LOCAL'))}</span><span>{render?.attribution ?? ''}</span></div>
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
  const labels = ru ? { title: 'Внешняя почта', subtitle: 'Письма из подключённых аккаунтов · локальный кэш', inbox: 'Входящие', compose: 'Написать', reply: 'Ответить', replyAll: 'Ответить всем', forward: 'Переслать', send: 'Отправить внешне', refresh: 'Обновить', search: 'Поиск почты', offline: 'Офлайн-кэш', provider: 'Аккаунт', noRuntime: 'Почта пока недоступна.', noMessages: 'Кэшированных писем нет.', select: 'Выберите письмо', noAccount: 'Добавьте почтовый аккаунт в настройках.', images: 'Внешние изображения заблокированы по умолчанию.', attachments: 'Вложения', download: 'Скачать', saveAttachment: 'Сохранить приватно', markRead: 'Пометить прочитанным', star: 'Звезда', move: 'Переместить', delete: 'Удалить', draft: 'Черновик', outbox: 'Исходящие', sent: 'Отправлено', unread: 'Непрочитанные', bodyUnavailable: 'Тело письма ещё не закэшировано.', recipient: 'Получатели через запятую', subject: 'Тема', body: 'Текст письма', save: 'Сохранить черновик', sendNotice: 'Отправка выполняется через выбранный почтовый аккаунт.', external: 'Внешняя почта', host: 'НЕ ПОДКЛЮЧЕНО' } : { title: 'External Email', subtitle: 'Messages from connected accounts · local cache', inbox: 'Inbox', compose: 'Compose', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward', send: 'Send externally', refresh: 'Refresh', search: 'Search mail', offline: 'Offline local cache', provider: 'Account', noRuntime: 'Mail is not available yet.', noMessages: 'No cached messages.', select: 'Select a message', noAccount: 'Add a mail account in Settings.', images: 'External images are blocked by default.', attachments: 'Attachments', download: 'Download', saveAttachment: 'Save privately', markRead: 'Mark read', star: 'Star', move: 'Move', delete: 'Delete', draft: 'Draft', outbox: 'Outbox', sent: 'Sent', unread: 'Unread', bodyUnavailable: 'Body is not cached yet.', recipient: 'Recipients, comma separated', subject: 'Subject', body: 'Message body', save: 'Save draft', sendNotice: 'Sending uses the mail account you choose.', external: 'External Email', host: 'NOT CONNECTED' };

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

  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="mail" size={15} /></span><span>{labels.external}</span><span className="surface-badge">{labels.host}</span></div><h1>{labels.title}</h1><p className="surface-description">{labels.noRuntime}</p><div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{labels.provider}</strong><small>{labels.noAccount}</small></div></div></div>;
  const currentAccount = accounts.find(value => value.id === selectedAccount);
  const currentFolder = folders.find(value => value.id === selectedFolder);
  const messageBody = rendered ?? (selectedMessage ? { mode: 'TEXT' as const, value: selectedMessage.bodyText ?? selectedMessage.snippet, blockedExternalImages: selectedMessage.externalImageUrls, safeLinks: [] } : undefined);
  return <div className="mail-surface">
    <div className="surface-kicker"><span className="surface-icon"><Icon name="mail" size={15} /></span><span>{labels.external}</span><span className="surface-badge">{currentAccount?.providerKind ?? labels.provider}</span></div>
    <div className="mail-heading"><div><h1>{labels.title}</h1><p className="surface-description">{labels.subtitle}</p></div><div className="mail-actions"><button className="secondary-button" onClick={() => void refresh()}>{labels.refresh}</button><button className="primary-button" onClick={() => void compose()}>{labels.compose}</button></div></div>
    {currentAccount && <div className="mail-account"><strong>{currentAccount.label}</strong><span>{currentAccount.address.address}</span><small>{currentAccount.enabled ? labels.offline : labels.noAccount}{currentAccount.attention ? ' · ' + currentAccount.attention : ''}</small></div>}
    {!accounts.length && <div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{labels.noAccount}</strong><small>{labels.noRuntime}</small></div></div>}
    <div className="mail-layout">
      <aside className="mail-sidebar"><span className="section-label">{labels.provider}</span>{folders.map(folder => <button key={folder.id} className={folder.id === selectedFolder ? 'mail-folder active' : 'mail-folder'} onClick={() => { setSelectedFolder(folder.id); setSelectedMessage(undefined); }}>{folder.name}<small>{folder.unreadCount ?? ''}</small></button>)}<span className="section-label mail-section-label">{labels.outbox}</span>{outbox.slice(0, 12).map(entry => <div className="mail-outbox-row" key={entry.id}><span>{entry.state}</span><small>{entry.lastError ?? entry.stableMessageId.slice(0, 18)}</small></div>)}</aside>
      <main className="mail-main"><form className="mail-search" onSubmit={runSearch}><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/><button className="secondary-button">{labels.search}</button></form>{results.length > 0 && <div className="mail-search-results">{results.map(result => <button key={result.id} onClick={() => void openSearchResult(result.id)}><strong>{result.title}</strong><small>{result.kind} · {result.snippet}</small></button>)}</div>}{messages.length ? <div className="mail-message-list">{messages.map(message => <button key={message.id} className={'mail-message-row' + (selectedMessage?.id === message.id ? ' active' : '') + (!message.flags.includes('SEEN') ? ' unread' : '')} onClick={() => openMessage(message)}><span className="mail-message-dot">{message.flags.includes('STARRED') ? '★' : '·'}</span><span className="mail-message-copy"><strong>{message.from.name ?? message.from.address}</strong><b>{message.subject || labels.noMessages}</b><small>{message.snippet}</small></span><time>{new Date(message.receivedAt).toLocaleDateString()}</time></button>)}</div> : <div className="mail-empty"><span>✉</span><p>{selectedAccount ? labels.noMessages : labels.noAccount}</p></div>}</main>
      <section className="mail-reader">{draft ? <div className="mail-compose"><div className="mail-reader-heading"><span className="section-label">{labels.draft}</span><button className="secondary-button" onClick={() => setDraft(undefined)}>×</button></div><label>{labels.recipient}<input value={addresses(draft.to)} onChange={event => updateDraft({ to: parseDesktopMailAddresses(event.target.value) })}/></label><label>{labels.subject}<input value={draft.subject} onChange={event => updateDraft({ subject: event.target.value })}/></label><label>{labels.body}<textarea value={draft.bodyText} onChange={event => updateDraft({ bodyText: event.target.value })}/></label><div className="mail-compose-actions"><button className="secondary-button" onClick={() => void saveDraft()}>{labels.save}</button><button className="primary-button" onClick={() => void sendDraft()}>{labels.send}</button></div><small className="mail-disclosure">{labels.sendNotice}</small></div> : selectedMessage ? <><div className="mail-reader-heading"><div><span className="section-label">{currentFolder?.name ?? labels.external}</span><h2>{selectedMessage.subject || labels.noMessages}</h2><small>{addresses([selectedMessage.from])} · {new Date(selectedMessage.receivedAt).toLocaleString()}</small></div><div className="mail-reader-actions"><button className="secondary-button" onClick={() => void runtime.reply?.(selectedMessage.id).then(value => compose(value))}>{labels.reply}</button><button className="secondary-button" onClick={() => void runtime.reply?.(selectedMessage.id, true).then(value => compose(value))}>{labels.replyAll}</button><button className="secondary-button" onClick={() => void runtime.forward?.(selectedMessage.id).then(value => compose(value))}>{labels.forward}</button></div></div><div className="mail-policy-note">{labels.images}</div>{messageBody?.mode === 'SANITIZED_HTML' ? <div className="mail-body" onClick={event => { const target = event.target as HTMLElement; const anchor = target.closest('a'); if (anchor?.href) { event.preventDefault(); void runtime.openExternal?.(anchor.href); } }} dangerouslySetInnerHTML={{ __html: messageBody.value }} /> : <pre className="mail-body mail-body-text">{messageBody?.value ?? labels.bodyUnavailable}</pre>}{messageBody?.blockedExternalImages.length ? <small className="mail-blocked-images">{messageBody.blockedExternalImages.length} {ru ? 'заблокированных удалённых изображений' : 'blocked remote image(s)'}</small> : null}{selectedMessage.attachments.length > 0 && <div className="mail-attachments"><span className="section-label">{labels.attachments}</span>{selectedMessage.attachments.map(attachment => <div className="mail-attachment" key={attachment.id}><span>▤</span><strong>{attachment.filename}</strong><small>{formatBytes(attachment.sizeBytes)} · {attachment.contentAvailable ? (ru ? 'кэшировано' : 'cached') : (ru ? 'отложено/приватно' : 'lazy/private')}</small><button className="secondary-button" onClick={() => void attachmentAction(selectedMessage.id, attachment.id, false)}>{labels.download}</button><button className="secondary-button" onClick={() => void attachmentAction(selectedMessage.id, attachment.id, true)}>{labels.saveAttachment}</button></div>)}</div>}<div className="mail-reader-footer"><button className="secondary-button" onClick={() => void runtime.markRead?.(selectedMessage.id, !selectedMessage.flags.includes('SEEN'))}>{labels.markRead}</button><button className="secondary-button" onClick={() => void runtime.setStarred?.(selectedMessage.id, !selectedMessage.flags.includes('STARRED'))}>★ {labels.star}</button><button className="secondary-button" onClick={() => void runtime.delete?.(selectedMessage.id)}>{labels.delete}</button></div></> : <div className="mail-empty"><span><Icon name="folder" size={16} /></span><p>{labels.select}</p></div>}</section>
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
  const labels = ru ? { unavailable: 'Календарь пока недоступен', boundary: 'Подключите локальный календарь, чтобы создавать и просматривать события.', today: 'Сегодня', previous: 'Назад', next: 'Вперёд', timezone: 'Часовой пояс', shared: 'Общие календари', create: 'Новое событие', free: 'Найти свободное время', empty: 'Нет событий в выбранном диапазоне', day: 'День', week: 'Неделя', month: 'Месяц', agenda: 'Повестка', side: 'Свойства и ссылки', newEvent: 'Событие создано' } : { unavailable: 'Calendar is not available yet', boundary: 'Connect a local calendar to create and view events.', today: 'Today', previous: 'Previous', next: 'Next', timezone: 'Timezone', shared: 'Shared calendars', create: 'New event', free: 'Find free time', empty: 'No events in the selected range', day: 'Day', week: 'Week', month: 'Month', agenda: 'Agenda', side: 'Properties and links', newEvent: 'Event created' };
  React.useEffect(() => subscribeDesktopCalendarRuntime(() => setRuntime(getDesktopCalendarRuntime())), []);
  const refresh = React.useCallback(async () => { if (!runtime) return; const nextCalendars = await runtime.calendars(); setCalendars(nextCalendars); const calendarId = selectedCalendar ?? nextCalendars[0]?.id; setSelectedCalendar(calendarId); if (calendarId) setEvents(await runtime.events({ calendarId, expand: view !== 'AGENDA' })); }, [runtime, selectedCalendar, view]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const create = async () => { if (!runtime?.createEvent || !selectedCalendar) { setNotice(labels.boundary); return; } const start = new Date(Date.now() + 60 * 60_000); start.setMinutes(0, 0, 0); const end = new Date(start.getTime() + 60 * 60_000); await runtime.createEvent({ calendarId: selectedCalendar, title: labels.create, start: start.toISOString(), end: end.toISOString() }); setNotice(labels.newEvent); await refresh(); };
  return <div className="calendar-surface" data-calendar-id={tab.object?.id ?? tab.id}>
    <div className="surface-kicker"><span className="surface-icon"><Icon name="canvas" size={15} /></span><span>{t.calendar}</span><span className="surface-badge">{t.local}</span></div>
    <div className="calendar-heading"><div><h1>{tab.title}</h1><p className="surface-description">{runtime ? `${calendars.length} ${labels.shared} · ${calendars.find(value => value.id === selectedCalendar)?.timezone ?? 'UTC'}` : labels.unavailable}</p></div><div className="calendar-actions"><button className="secondary-button" onClick={() => setNotice(labels.boundary)}>{labels.today}</button><button className="primary-button" onClick={() => void create()}>{labels.create}</button></div></div>
    <div className="calendar-toolbar"><div className="calendar-view-switcher">{([['DAY', labels.day], ['WEEK', labels.week], ['MONTH', labels.month], ['AGENDA', labels.agenda]] as const).map(([value, label]) => <button key={value} className={view === value ? 'active' : ''} onClick={() => setView(value)}>{label}</button>)}</div><div className="calendar-nav"><button onClick={() => setNotice(labels.previous)}>‹</button><button onClick={() => setNotice(labels.today)}>{labels.today}</button><button onClick={() => setNotice(labels.next)}>›</button></div>{calendars.length > 0 && <select value={selectedCalendar} onChange={event => setSelectedCalendar(event.target.value)} aria-label={labels.shared}>{calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name} · {calendar.visibility}</option>)}</select>}</div>
    <div className="calendar-layout"><main className="calendar-grid">{events.length ? events.map(event => <article key={event.id} className="calendar-event"><time>{formatCalendarTime(event.start)}–{formatCalendarTime(event.end)}</time><strong>{event.title || 'BUSY'}</strong><small>{event.timezone}</small></article>) : <div className="calendar-empty"><span>□</span><p>{runtime ? labels.empty : labels.boundary}</p></div>}</main><aside className="calendar-side"><span className="section-label">{labels.side}</span><p>{labels.timezone}: {calendars.find(value => value.id === selectedCalendar)?.timezone ?? 'UTC'}</p><p>{labels.shared}: {calendars.length}</p><button className="secondary-button" onClick={() => { if (runtime?.findCommonTime) void runtime.findCommonTime().then(value => setNotice(value[0] ? `${value[0].start} – ${value[0].end}` : labels.empty)); else setNotice(labels.boundary); }}>{labels.free}</button>{notice && <small>{notice}</small>}</aside></div>
  </div>;
}


function PlaceholderSurface({ tab, t }: { tab: DesktopTab; t: Copy }) {
  return <div className="placeholder-surface"><span className="placeholder-icon">{tabIcon(tab.kind)}</span><span className="surface-kicker">{t.placeholder}</span><h1>{tab.title}</h1><p>{t.placeholderBody}</p><div className="adapter-note"><span><Icon name="info" size={16} /></span><div><strong>{t.placeholder}</strong><small>{t.placeholderBody}</small></div></div></div>;
}

function EmptyPane({ shell, t }: { shell: DesktopShellController; t: Copy }) { return <div className="empty-pane"><span>⌘</span><p>{t.empty}</p><button className="secondary-button" onClick={() => shell.openReference({ kind: 'home', id: 'home', label: t.home })}>{t.open}</button></div>; }

function CaptureSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopCaptureRuntime | undefined>(getDesktopCaptureRuntime);
  const [page, setPage] = React.useState<Awaited<ReturnType<DesktopCaptureRuntime['list']>>>({ items: [], total: 0 });
  const initialCaptureId = tab.object?.id && tab.object.id !== 'capture' ? tab.object.id : '';
  const [value, setValue] = React.useState(''); const [query, setQuery] = React.useState(''); const [selectedId, setSelectedId] = React.useState(initialCaptureId); const [suggestions, setSuggestions] = React.useState<Awaited<ReturnType<DesktopCaptureRuntime['suggestions']>>>([]); const [destination, setDestination] = React.useState<CaptureDestinationKind>('TASK'); const [preview, setPreview] = React.useState<Awaited<ReturnType<DesktopCaptureRuntime['preview']>>>(); const [notice, setNotice] = React.useState(''); const ru = t.home === 'Главная';
  const destinations: readonly CaptureDestinationKind[] = runtime?.destinations ?? ['TASK', 'VAULT', 'WEB_LIBRARY', 'FILES', 'PHOTOS', 'DOCUMENTS', 'CONTACTS', 'CALENDAR', 'WORKBOARD', 'SHARED_FOLDER'];
  const refresh = React.useCallback(async () => { if (!runtime) return; try { const next = await runtime.list({ query: query.trim() || undefined, limit: 64 }); setPage(next); setSelectedId(current => current && next.items.some(item => item.id === current) ? current : initialCaptureId && next.items.some(item => item.id === initialCaptureId) ? initialCaptureId : ''); } catch { setNotice(t.captureNoRuntime); } }, [initialCaptureId, query, runtime, t.captureNoRuntime]);
  React.useEffect(() => subscribeDesktopCaptureRuntime(() => setRuntime(getDesktopCaptureRuntime())), []);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => { if (!runtime?.subscribe) return; return runtime.subscribe(() => void refresh()); }, [refresh, runtime]);
  const select = async (item: Awaited<ReturnType<DesktopCaptureRuntime['list']>>['items'][number]) => { setSelectedId(item.id); setPreview(undefined); try { setSuggestions(await runtime!.suggestions(item.id)); } catch { setSuggestions([]); } };
  React.useEffect(() => { const item = page.items.find(candidate => candidate.id === selectedId); if (item && runtime) void runtime.suggestions(item.id).then(setSuggestions).catch(() => setSuggestions([])); }, [page.items, runtime, selectedId]);
  const capture = async () => { if (!runtime || !value.trim()) return; try { const item = /^https?:\/\//i.test(value.trim()) ? await runtime.captureUrl(value.trim()) : await runtime.captureText(value); setValue(''); await refresh(); await select(item); } catch (error) { setNotice(error instanceof Error ? error.message : t.captureUnsafe); } };
  const captureClipboard = async () => { if (!runtime) return; try { const item = await runtime.captureClipboard({ ownerConfirmed: true }); await refresh(); await select(item); } catch (error) { setNotice(error instanceof Error ? error.message : t.captureNoRuntime); } };
  const captureFile = async (file: File) => { if (!runtime) return; try { const item = await runtime.captureFile({ name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()), source: { kind: 'FILE_DROP', label: file.name } }); await refresh(); await select(item); } catch (error) { setNotice(error instanceof Error ? error.message : t.captureNoRuntime); } };
  const pickCaptureFile = async () => {
    if (!runtime) return;
    try {
      const file = await pickDesktopFile('file');
      if (!file) return;
      const item = await runtime.captureFile({ name: file.name, mimeType: file.mimeType, size: file.size, read: async () => file.bytes.slice(), source: { kind: 'FILE_DROP', label: `Native picker · ${file.name}` } });
      await refresh(); await select(item);
    } catch (error) { setNotice(error instanceof Error ? error.message : t.captureNoRuntime); }
  };
  const route = async () => { if (!runtime || !selectedId) return; try { if (!preview) { setPreview(await runtime.preview(selectedId, destination)); return; } const result = await runtime.route(selectedId, destination); setNotice(ru ? 'Объект отправлен.' : 'Capture routed.'); setPreview(undefined); await refresh(); if (destination === 'TASK') shell.openReference({ kind: 'tasks', id: result.reference.id, label: result.reference.label }); } catch (error) { setNotice(error instanceof Error ? error.message : t.captureNoRuntime); } };
  const selected = page.items.find(item => item.id === selectedId);
  return <div className="capture-surface" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); const files = [...event.dataTransfer.files].slice(0, 32); if (files.length) { void Promise.all(files.map(captureFile)); return; } const raw = event.dataTransfer.getData('application/x-keystone-ref'); if (raw && runtime) { try { const ref = JSON.parse(raw) as { type: string; id: string; label?: string; dataClass?: 'PUBLIC' | 'USER_EXPLICIT' | 'PRIVATE' | 'SECRET' }; void runtime.capture.captureReference({ reference: { type: ref.type, id: ref.id, label: ref.label, dataClass: ref.dataClass ?? 'USER_EXPLICIT' }, source: { kind: 'KEYSTONE_OBJECT', label: ref.label } }).then(item => { void refresh(); void select(item); }); } catch { setNotice(t.captureUnsafe); } } }}>
    <div className="surface-kicker"><span className="surface-icon"><Icon name="capture" size={15} /></span><span>{t.capture}</span><span className="surface-badge">{runtime?.hostConnected ? (ru ? 'Подключено' : 'Connected') : t.local}</span></div>
    <div className="capture-heading"><div><h1>{t.capture}</h1><p className="surface-description">{t.captureHint}</p></div><kbd>{isMac() ? '⌘' : 'Ctrl'} ⇧ Space</kbd></div>
    {!runtime?.hostConnected && <div className="adapter-note"><span><Icon name="info" size={17} /></span><div><strong>{t.captureNoRuntime}</strong><small>{t.captureUnsafe}</small></div></div>}
    <div className="capture-composer"><textarea value={value} onChange={event => setValue(event.target.value)} placeholder={t.capturePlaceholder} aria-label={t.capturePlaceholder} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void capture(); } }} /><div className="capture-actions"><button className="primary-button" onClick={() => void capture()} disabled={!value.trim()}>{t.capture}</button><button className="secondary-button" onClick={() => void captureClipboard()}>{t.captureClipboard}</button><button className="secondary-button" onClick={() => void pickCaptureFile()}>{t.files}</button><button className="secondary-button" onClick={() => { if (!runtime) { setNotice(t.captureNoRuntime); return; } void runtime.captureBrowserPage({ ownerConfirmed: true }).then(item => { void refresh(); void select(item); }).catch(error => setNotice(error instanceof Error ? error.message : t.captureNoRuntime)); }}>{t.captureBrowser}</button><button className="secondary-button" onClick={() => { if (!runtime) { setNotice(t.captureNoRuntime); return; } void runtime.captureBrowserSelection({ ownerConfirmed: true }).then(item => { void refresh(); void select(item); }).catch(error => setNotice(error instanceof Error ? error.message : t.captureNoRuntime)); }}>{t.captureSelection}</button></div></div>
    <div className="capture-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={ru ? 'Поиск захватов' : 'Search tray'} aria-label={ru ? 'Поиск захватов' : 'Search tray'} /><span>{page.total} · {t.captureTray}</span><button className="secondary-button" onClick={() => void refresh()}>{t.refresh}</button></div>
    <div className="capture-layout"><div className="capture-list"><span className="section-label">{t.captureTray}</span>{page.items.length ? page.items.map(item => <button key={item.id} className={`capture-item${item.id === selectedId ? ' active' : ''}`} onClick={() => void select(item)}><span className="capture-item-icon"><Icon name={item.payload.kind === 'URL' || item.payload.kind === 'BROWSER_PAGE' ? 'external-link' : item.payload.kind === 'FILE' || item.payload.kind === 'IMAGE' || item.payload.kind === 'DOCUMENT' ? 'file-text' : 'capture'} size={16} /></span><span><strong>{item.title}</strong><small>{captureSourceLabel(item.provenance.source.kind, ru)} · {captureStateLabel(item.state, ru)}</small></span></button>) : <div className="adapter-note"><span><Icon name="capture" size={17} /></span><div><strong>{t.captureNoItems}</strong><small>{t.captureDrop}</small></div></div>}</div><div className="capture-detail">{selected ? <><span className="section-label">{t.captureSource}</span><h2>{selected.title}</h2><p className="capture-preview-text">{capturePreviewText(selected)}</p><small>{captureSourceLabel(selected.provenance.source.kind, ru)} · {captureStateLabel(selected.state, ru)} · {captureAccessLabel(selected.provenance.dataClass, ru)}</small><div className="capture-suggestions"><span className="section-label">{t.captureSuggestions}</span>{suggestions.filter(item => destinations.includes(item.destination)).map(item => <button key={item.destination} className={destination === item.destination ? 'selected' : ''} onClick={() => { setDestination(item.destination); setPreview(undefined); }}><strong>{captureDestinationLabel(item.destination, ru)}</strong><small>{item.reason}</small></button>)}</div><div className="capture-route"><select aria-label={ru ? 'Куда отправить' : 'Destination'} value={destination} onChange={event => { setDestination(event.target.value as CaptureDestinationKind); setPreview(undefined); }}>{destinations.map(kind => <option key={kind} value={kind}>{captureDestinationLabel(kind, ru)}</option>)}</select><button className="primary-button" disabled={!destinations.includes(destination) || (runtime?.destinations?.length === 1 && !['TEXT', 'URL'].includes(selected.payload.kind))} onClick={() => void route()}>{preview ? t.captureConfirm : t.capturePreview}</button><button className="secondary-button" onClick={() => { void runtime!.dismiss(selected.id).then(() => refresh()); }}>{t.captureDismiss}</button></div>{preview && <div className="capture-consequence"><strong>{preview.title}</strong><small>{preview.summary}</small><small>{preview.disclosure} · {preview.warnings.join(' ') || t.privacy}</small></div>}</> : <div className="placeholder-surface"><span className="placeholder-icon"><Icon name="capture" size={26} /></span><h2>{t.captureTray}</h2><p>{t.captureDrop}</p></div>}</div></div>{notice && <small className="continuity-notice">{notice}</small>}
  </div>;
}


function capturePreviewText(item: Awaited<ReturnType<DesktopCaptureRuntime['list']>>['items'][number]): string { const payload = item.payload; if (payload.kind === 'TEXT') return payload.text; if (payload.kind === 'URL') return payload.url; if (payload.kind === 'BROWSER_PAGE') return `${payload.url}\n${payload.excerpt ?? ''}`; if (payload.kind === 'BROWSER_SELECTION') return payload.selectedText; if (payload.kind === 'REFERENCE') return `${payload.reference.type} · ${payload.reference.id}`; if (payload.kind === 'CONTACT_CARD') return payload.vCard; if (payload.kind === 'MULTI') return `${payload.items.length} items`; return `${payload.file.name} · ${payload.file.size} B`;
}

function InlineKeystoneLinks({ text, shell }: { text: string; shell: DesktopShellController }) {
  const tokens = text.split(/(keystone:\/\/[^\s)\]>]+)/g);
  return <>{tokens.map((token, index) => {
    const ref = parseKeystoneLink(token);
    return ref ? <button type="button" className="inline-keystone-link" key={`${token}-${index}`} onClick={() => shell.openReference(ref)}>{token}</button> : <React.Fragment key={`${token}-${index}`}>{token}</React.Fragment>;
  })}</>;
}

function ContextSidebar({ data, t }: { data: ReturnType<ContextProviderRegistry['resolve']>; t: Copy }) {
  return <aside className="context-sidebar" data-keystone-region="sidebar" aria-label={t.context}><div className="sidebar-heading"><div><span className="section-label">{t.context}</span><h2>{data.title}</h2></div><span className="sidebar-dots">⋯</span></div>{data.sections.map(section => <section className="context-section" key={section.id}><h3>{section.title}</h3>{section.items.map(item => <p key={item}>{item}</p>)}</section>)}<div className="sidebar-footer"><span className="status-light"/> {t.privacy}</div></aside>;
}

function AgentBotPanel({ shell, t, activeTab, prefill, onClose }: { shell: DesktopShellController; t: Copy; activeTab?: DesktopTab; prefill?: string; onClose: () => void }) {
  void prefill;
  const browserPage = activeTab?.kind === 'browser' ? shell.browserPage(activeTab.id) : undefined;
  const ru = t.home === 'Главная';
  const scope = browserPage ? `${activeTab?.title ?? t.browser} · ${browserPage.origin} · ${t.revisionLabel} ${browserPage.pageRevision}` : activeTab?.object ? `${activeTab.title} · ${activeTab.object.id}` : t.noObject;
  const toolFlow = shell.toolFlowState();
  const toolFlowStatus = (status: string): string => ru ? ({ running: 'выполняется', paused: 'приостановлено', completed: 'завершено', failed: 'ошибка', cancelled: 'отменено' }[status] ?? status) : status;
  const sourceCount = toolFlow?.sourceCount ?? 0;
  const sourceLabel = ru ? (sourceCount === 1 ? 'источник' : sourceCount < 5 ? 'источника' : 'источников') : (sourceCount === 1 ? t.source : t.sources);
  return <aside className="agent-panel" data-keystone-region="inspector" aria-label={t.agent}><div className="agent-panel-heading"><div><span className="section-label">{t.agent}</span><h2>{t.local}</h2></div><IconButton icon="close" size={14} label={t.close} onClick={onClose} /></div><div className="agent-scope"><span className="scope-dot"/><div><small>{t.agentScope}</small><strong>{scope}</strong></div></div>{toolFlow && <section className="toolflow-card" aria-label="ToolFlow"><div className="toolflow-heading"><div><span className="section-label">ToolFlow</span><strong>{toolFlowStatus(toolFlow.status)}</strong></div><span className="privacy-mark">{toolFlow.privacyClass}</span></div><div className="toolflow-sequence">{toolFlow.steps.map((step, index) => <React.Fragment key={step.id}><span className={`toolflow-step ${step.status}`}><i/>{step.label}</span>{index < toolFlow.steps.length - 1 && <span className="toolflow-arrow"><Icon name="arrow-right" size={11} /></span>}</React.Fragment>)}</div><div className="toolflow-meta"><span>{sourceCount} {sourceLabel}</span><span>{toolFlow.executionId.slice(0, 18)}</span></div>{(toolFlow.status === 'running' || toolFlow.status === 'paused') && <div className="toolflow-actions"><button type="button" className="secondary-button" onClick={() => toolFlow.status === 'paused' ? shell.resumeToolFlow() : shell.pauseToolFlow()}>{toolFlow.status === 'paused' ? t.resume : t.pause}</button><button type="button" className="secondary-button" onClick={() => shell.cancelToolFlow()}>{t.cancel}</button></div>}</section>}<div className="agent-empty agent-unavailable"><span><Icon name="bot" size={24} /></span><p>{ru ? 'Локальная среда AI не подключена. Запросы не выполняются и данные не покидают устройство.' : 'A local AI host is not connected. Requests are not executed and data does not leave the device.'}</p></div><div className="agent-composer agent-composer-disabled"><span>{t.placeholder}</span><small>{t.agentHint}</small></div></aside>;
}

function ActivityEditor({ shell, t, onClose }: { shell: DesktopShellController; t: Copy; onClose: () => void }) {
  const items = shell.chromeState.activityBar;
  return <div className="floating-editor activity-editor"><div className="editor-heading"><div><span className="section-label">{t.customize}</span><h2>{t.workspace}</h2></div><IconButton icon="close" size={14} label={t.close} onClick={onClose} /></div><p>{t.extensionSlot}</p>{items.map((item, index) => <div className="activity-edit-row" key={item.id}><span className="drag-handle"><Icon name="ellipsis" size={14} /></span><span className="edit-icon"><Icon name={(item.icon as IconName) || 'circle'} size={15} /></span><strong>{activityLabel(item, t)}</strong><button type="button" onClick={() => shell.setActivityVisible(item.id, !item.visible)}>{item.visible ? t.hide : t.show}</button><button type="button" aria-label={item.pinned ? t.unpin : t.pin} onClick={() => shell.setActivityPinned(item.id, !item.pinned)}><Icon name="pin" size={13} /></button><button type="button" aria-label={t.moveUp} onClick={() => index > 0 && shell.reorderActivity(item.id, index - 1)} disabled={index === 0}><Icon name="arrow-up" size={13} /></button><button type="button" aria-label={t.moveDown} onClick={() => index < items.length - 1 && shell.reorderActivity(item.id, index + 1)} disabled={index === items.length - 1}><Icon name="arrow-down" size={13} /></button></div>)}<button className="secondary-button editor-done" type="button" onClick={onClose}>{t.done}</button></div>;
}

function WorkspaceMenu({ shell, t, onClose }: { shell: DesktopShellController; t: Copy; onClose: () => void }) {
  const [newName, setNewName] = React.useState('');
  const records = shell.listWorkspaces();
  const tabCount = (count: number): string => {
    if (t.home !== 'Главная') return `${count} ${count === 1 ? 'tab' : t.tabs}`;
    const word = count % 10 === 1 && count % 100 !== 11 ? 'вкладка' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? 'вкладки' : t.tabs;
    return `${count} ${word}`;
  };
  return <div className="floating-menu workspace-menu"><span className="section-label">{t.switcher}</span>{records.map(record => <button key={record.id} className={record.id === shell.getSnapshot().workspace.id ? 'workspace-option active' : 'workspace-option'} onClick={() => { shell.switchWorkspace(record.id); onClose(); }}><span className="workspace-dot"/><span>{record.name}</span><small>{tabCount(record.tabs.length)}</small></button>)}<div className="workspace-create"><input value={newName} onChange={event => setNewName(event.target.value)} placeholder={t.newWorkspace} onKeyDown={event => { if (event.key === 'Enter' && newName.trim()) { shell.createWorkspace(newName); setNewName(''); onClose(); } }}/><button onClick={() => { if (newName.trim()) { shell.createWorkspace(newName); setNewName(''); onClose(); } }}>+</button></div><div className="workspace-menu-actions"><button onClick={() => { shell.renameWorkspace(window.prompt(t.rename, shell.getSnapshot().workspace.name) ?? shell.getSnapshot().workspace.name); onClose(); }}>{t.rename}</button><button onClick={() => { shell.removeWorkspace(); onClose(); }}>{t.delete}</button></div></div>;
}

function OmniboxMenu({ value, t, onChoose }: { value: string; t: Copy; onChoose: (value: string) => void }) {
  const trimmed = value.trim();
  const suggestions: Array<{ value: string; icon: IconName; label: string }> = trimmed ? [{ value: trimmed, icon: 'search', label: t.search }, { value: `>${trimmed}`, icon: 'command', label: t.command }] : [];
  return <div className="omnibox-menu">{suggestions.length ? suggestions.map(suggestion => <button type="button" key={`${suggestion.value}-${suggestion.label}`} onMouseDown={event => event.preventDefault()} onClick={() => onChoose(suggestion.value)}><span><Icon name={suggestion.icon} size={15} /></span><span>{suggestion.value}</span><small>{suggestion.label}</small></button>) : <p className="omnibox-empty">{t.searchHint}</p>}</div>;
}

function QuickActions({ t, onChoose, onCapture, onNewTab }: { t: Copy; onChoose: (ref: KeystoneObjectReference) => void; onCapture: () => void; onNewTab: () => void }) {
  const ru = t.home === 'Главная';
  const actions: Array<{ key: string; label: string; icon: IconName; ref?: KeystoneObjectReference; run?: () => void }> = [
    { key: 'task', label: ru ? 'Новая задача' : 'New Task', icon: 'task', ref: { kind: 'tasks', id: 'new-task', label: t.task } },
    { key: 'document', label: ru ? 'Новый документ' : 'New Document', icon: 'document', ref: { kind: 'document', id: 'new-document', label: ru ? 'Новый документ' : 'New document' } },
    { key: 'ai', label: ru ? 'Новый AI-чат' : 'New AI Chat', icon: 'bot', ref: { kind: 'ai', id: 'new-ai-chat', label: t.localAI } },
    { key: 'tab', label: ru ? 'Новая вкладка' : 'New Tab', icon: 'plus', run: onNewTab },
    { key: 'capture', label: t.capture, icon: 'capture', run: onCapture },
  ];
  return <div className="floating-menu quick-actions"><span className="section-label">{t.new}</span><div className="quick-grid">{actions.map(action => <button type="button" key={action.key} onClick={() => action.run ? action.run() : action.ref && onChoose(action.ref)}><span><Icon name={action.icon} size={17} /></span>{action.label}</button>)}</div></div>;
}

function QuickCaptureOverlay({ shell, t, onClose }: { shell: DesktopShellController; t: Copy; onClose: () => void }) {
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const runtime = getDesktopCaptureRuntime();
  React.useEffect(() => inputRef.current?.focus(), []);
  const save = async () => {
    const content = value.trim();
    if (!content || !runtime || busy) return;
    setBusy(true);
    try {
      const item = /^https?:\/\//i.test(content) ? await runtime.captureUrl(content) : await runtime.captureText(content);
      shell.setNotice(`${t.saved}: ${item.title}`);
      onClose();
    } catch (error) {
      shell.setNotice(error instanceof Error ? error.message : t.captureUnsafe);
    } finally {
      setBusy(false);
    }
  };
  return <div className="quick-capture-backdrop" role="presentation" onPointerDown={event => { if (event.currentTarget === event.target) onClose(); }}><section className="quick-capture-overlay" role="dialog" aria-modal="true" aria-labelledby="quick-capture-title"><div className="quick-capture-heading"><div><span className="section-label">{t.local}</span><h2 id="quick-capture-title">{t.capture}</h2></div><IconButton icon="close" size={14} label={t.close} onClick={onClose} /></div><textarea ref={inputRef} value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') onClose(); if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save(); } }} placeholder={t.capturePlaceholder} aria-label={t.capturePlaceholder} /><div className="quick-capture-footer"><button type="button" className="quiet-button" onClick={() => { shell.openReference({ kind: 'capture', id: 'capture', label: t.capture }); onClose(); }}>{t.home === 'Главная' ? 'Открыть список' : 'Open capture tray'}</button><small>{isMac() ? '⌘' : 'Ctrl'} + Enter · {t.saved.toLowerCase()}</small><div><button type="button" className="secondary-button" onClick={onClose}>{t.cancel}</button><button type="button" className="primary-button" onClick={() => void save()} disabled={!value.trim() || busy}>{busy ? '…' : t.capture}</button></div></div></section></div>;
}

function handleDrop(event: React.DragEvent, shell: DesktopShellController, fallback?: KeystoneObjectReference, paneId = shell.currentPaneId) {
  event.preventDefault();
  const droppedFiles = [...event.dataTransfer.files].slice(0, 32);
  if (droppedFiles.length) {
    const runtime = getDesktopCaptureRuntime();
    if (!runtime) { shell.setNotice('Capture host is unavailable.'); return; }
    void Promise.all(droppedFiles.map(file => runtime.captureFile({ name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()), source: { kind: 'FILE_DROP', label: file.name } }))).then(() => { shell.openReference({ kind: 'capture', id: 'capture', label: 'Quick Capture' }, { paneId }); }).catch(() => shell.setNotice('Capture file import failed.'));
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
  if (tab.kind === 'inbox') return t.inbox === 'Входящие' ? 'Сообщения, почта, звонки и события с ваших устройств.' : 'Messages, mail, calls, and activity from your devices.';
  if (tab.kind === 'tasks') return t.home === 'Главная' ? 'Личные задачи, списки, подзадачи, сроки и напоминания.' : 'Personal tasks, lists, subtasks, due dates, and reminders.';
  if (tab.kind === 'contacts') return t.home === 'Главная' ? 'Личная адресная книга, группы и проверка дубликатов.' : 'Personal address book, groups, and duplicate review.';
  if (tab.kind === 'publication') return t.publicationDisclosure;
  if (tab.kind === 'web-library') return t.webLibraryDescription;
  if (tab.kind === 'map') return t.maps;
  if (tab.kind === 'mail') return t.home === 'Главная' ? 'Внешняя почта: письма хранятся локально, отправка выполняется явно.' : 'External email: messages stay local, and sending is always explicit.';
  if (tab.kind === 'profile') return `${tab.title} · профиль, подписки и открытые материалы.`;
  if (tab.kind === 'chat') return 'Разговор, вложения и ссылки на объекты Keystone.';
  if (tab.kind === 'community') return 'Сообщество, роли и порядок обсуждений.';
  if (tab.kind === 'space') return 'Общее пространство с защищённым содержимым.';
  if (tab.kind === 'file') return `${t.files} · локальные версии и доступность содержимого.`;
  if (tab.kind === 'document') return t.documents === 'Документы' ? 'Документы и просмотр: PDF, EPUB, Markdown, аннотации и локальное распознавание.' : 'Documents and Reader: PDF, EPUB, Markdown, annotations, and local recognition.';
  if (tab.kind === 'capture') return t.captureHint;
  if (tab.kind === 'media') return `${t.photos} · личная лента, альбомы и явный обмен.`;
  if (tab.kind === 'music') return t.music === 'Музыка' ? 'Локальная музыкальная библиотека и воспроизведение.' : 'Local music library and playback.';
  if (tab.kind === 'video') return t.video === 'Видео' ? 'Видео, библиотека и воспроизведение.' : 'Video library and playback.';
  if (tab.kind === 'shorts') return t.shorts === 'Shorts' ? 'Короткие видео и персональная лента.' : 'Short-form video and a personal feed.';
  if (tab.kind === 'ai') return t.localAI === 'Локальный AI' ? 'Локальные модели без отправки приватных запросов в сеть.' : 'Local models without sending private requests to the network.';
  if (tab.kind === 'network') return t.connectivity === 'Связь' ? 'Состояние сети и доступные способы соединения.' : 'Network status and available connection methods.';
  return t.placeholderBody;
}

function tabIcon(kind: DesktopTab['kind']): React.ReactNode {
  const icons: Partial<Record<DesktopTab['kind'], IconName>> = {
    home: 'home', inbox: 'inbox', agent: 'bot', chat: 'message', profile: 'contacts', community: 'spaces', space: 'spaces', vault: 'vault', graph: 'graph', canvas: 'canvas', calendar: 'calendar', tasks: 'task', contacts: 'contacts', map: 'map', mail: 'mail', file: 'files', document: 'document', music: 'rss', playlist: 'list', video: 'play', shorts: 'play', ai: 'bot', network: 'network', publication: 'edit', workboard: 'board', subscriptions: 'rss', 'web-library': 'book-open', settings: 'settings', browser: 'globe', media: 'image', capture: 'capture', unknown: 'circle',
  };
  return <Icon name={icons[kind] ?? 'circle'} size={14} />;
}

// Named exports make the host extension boundary explicit.  The shell owns
// composition, while each surface remains replaceable by a typed host adapter.
export { DesktopShell, ActivityBar, ContextSidebar, AgentBotPanel, CommandPalette, QuickActions, OmniboxMenu as Omnibox };
