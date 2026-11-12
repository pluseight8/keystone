import { emitDesktopWindowTransfer } from './desktop-window-transfer';
import type { DesktopWindowTransferStart } from './desktop-window-transfer';

/**
 * Model layer for the unified desktop shell.
 *
 * The shell deliberately owns only navigation/layout state.  It never copies
 * object payloads, private content, or credentials.  A tab stores a typed
 * Keystone object reference and the existing application services remain the
 * authority for loading data and checking permissions.
 */

export type DesktopObjectKind =
  | 'home'
  | 'inbox'
  | 'agent'
  | 'chat'
  | 'profile'
  | 'community'
  | 'space'
  | 'vault'
  | 'graph'
  | 'canvas'
  | 'calendar'
  | 'tasks'
  | 'contacts'
  | 'map'
  | 'mail'
  | 'file'
  | 'document'
  | 'music'
  | 'playlist'
  | 'video'
  | 'shorts'
  | 'ai'
  | 'network'
  | 'publication'
  | 'workboard'
  | 'subscriptions'
  | 'web-library'
  | 'settings'
  | 'browser'
  | 'media'
  | 'capture'
  | 'unknown';

export type DesktopVisibility = 'public' | 'contacts' | 'community' | 'private';

export interface KeystoneObjectReference {
  kind: DesktopObjectKind;
  id: string;
  /** Bounded local query for search/settings routes; never includes secrets. */
  query?: string;
  /** Exact immutable publication revision, when the route points to one. */
  revisionAddress?: string;
  label?: string;
  /** Vault note routes carry both the note identity and its owning vault. */
  vaultId?: string;
  visibility?: DesktopVisibility;
}

export interface DesktopTab {
  id: string;
  kind: DesktopObjectKind;
  title: string;
  object?: KeystoneObjectReference;
  url?: string;
  /** Non-sensitive browser session identity used to restore a host tab. */
  browserSessionId?: string;
  browserPageRevision?: number;
  browserOrigin?: string;
  browserDataClass?: 'PUBLIC' | 'USER_EXPLICIT' | 'PRIVATE' | 'SECRET';
  browserActivity?: 'IDLE' | 'OBSERVING' | 'NAVIGATING' | 'ACTING' | 'WAITING' | 'PAUSED' | 'NEEDS_CONFIRMATION' | 'FAILED';
  pinned: boolean;
  dirty: boolean;
  /** Set when the object no longer passes the host permission check. */
  locked?: boolean;
  createdAt: number;
}

/** Safe page metadata exposed to the shell.  Text is bounded and never
 * persisted with workspace records; the browser-engine host remains the
 * authority for full observations and credentials. */
export interface DesktopBrowserPageState {
  tabId: string;
  url: string;
  origin: string;
  title: string;
  pageRevision: number;
  dataClass: 'PUBLIC' | 'USER_EXPLICIT' | 'PRIVATE' | 'SECRET';
  visibleText?: string;
  interactiveCount?: number;
  screenshotRef?: string;
  updatedAt?: string;
}

export interface DesktopBrowserRuntimeState {
  sessionId?: string;
  page?: DesktopBrowserPageState;
  activity: DesktopTab['browserActivity'];
  paused?: boolean;
}

/** Structural bridge used by a host to project BrowserActionResult into the
 * real DesktopShell tab without importing a browser vendor or duplicating the
 * browser object. */
export interface DesktopBrowserActionResult {
  sessionId: string;
  tabId?: string;
  status: 'COMPLETED' | 'REJECTED' | 'NEEDS_CONFIRMATION' | 'STALE' | 'FAILED';
  page?: DesktopBrowserPageState;
  activity?: DesktopTab['browserActivity'];
}

export type DesktopToolFlowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
export interface DesktopToolFlowState {
  flowId: string;
  executionId: string;
  status: 'running' | 'completed' | 'partial' | 'failed' | 'paused' | 'cancelled';
  privacyClass: 'PUBLIC' | 'USER_EXPLICIT' | 'PRIVATE' | 'SECRET';
  steps: Array<{ id: string; label: string; status: DesktopToolFlowStepStatus; toolCount?: number }>;
  sourceCount: number;
  updatedAt: number;
}

export type PaneOrientation = 'horizontal' | 'vertical';

export type PaneNode =
  | { type: 'leaf'; id: string; tabIds: string[]; activeTabId?: string }
  | {
      type: 'split';
      id: string;
      orientation: PaneOrientation;
      ratio: number;
      first: PaneNode;
      second: PaneNode;
    };

export interface ActivityBarItem {
  id: string;
  kind: DesktopObjectKind | 'search' | 'plugins';
  label: string;
  icon: string;
  visible: boolean;
  pinned: boolean;
  extensionSlot?: boolean;
}

export interface WorkspaceChromeState {
  contextSidebarOpen: boolean;
  agentPanelOpen: boolean;
  activityBar: ActivityBarItem[];
  contextSidebarWidth: number;
  agentPanelWidth: number;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  tabs: DesktopTab[];
  closedTabs: DesktopTab[];
  paneTree: PaneNode;
  activePaneId: string;
  chrome: WorkspaceChromeState;
  updatedAt: number;
}

/** Native windows are views over one workspace record.  The registry stores
 * ownership and window-local chrome, never a second copy of Keystone data. */
export interface DesktopWindowGeometry {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
  fullscreen?: boolean;
}

export interface DesktopWindowRecord {
  id: string;
  workspaceId: string;
  tabIds: string[];
  activeTabId?: string;
  paneTree?: PaneNode;
  activePaneId?: string;
  chrome?: WorkspaceChromeState;
  geometry?: DesktopWindowGeometry;
  primary: boolean;
  updatedAt: number;
}

export interface DesktopWindowStorageEnvelope {
  version: 2;
  primaryWindowId: string;
  windows: DesktopWindowRecord[];
}

export interface DesktopWindowTransferCommit {
  readonly workspaceId: string;
  readonly tabId: string;
  readonly sourceWindowId: string;
  readonly targetWindowId: string;
  readonly sourceIndex: number;
  readonly targetIndex: number;
  readonly source: DesktopWindowRecord;
  readonly target: DesktopWindowRecord;
}

export interface DesktopWindowOpenRequest {
  windowId: string;
  tabId: string;
  title: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maximized?: boolean;
  fullscreen?: boolean;
}

export interface DesktopWindowBridge {
  open: (request: DesktopWindowOpenRequest) => Promise<boolean> | boolean;
  focus: (windowId: string) => Promise<void> | void;
  close?: (windowId: string) => Promise<void> | void;
  closeSelf?: () => Promise<void> | void;
}

export interface DesktopShellSnapshot {
  workspace: WorkspaceRecord;
  navigation: NavigationEntry[];
  toolFlow?: DesktopToolFlowState;
}

export type DesktopStartupSurface = 'last-opened' | 'home' | 'feed' | 'video' | 'messages' | 'storage' | 'calendar' | 'map' | 'mail' | 'vault' | 'workspace';
export interface DesktopStartupPreference { version: 1; surface: DesktopStartupSurface; target?: KeystoneObjectReference; }

export interface DesktopStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const WORKSPACES_KEY = 'keystone.desktop.workspaces.v1';
const CURRENT_WORKSPACE_KEY = 'keystone.desktop.current-workspace.v1';
const STARTUP_SURFACE_KEY = 'keystone.desktop.startup-surface.v1';
export const DESKTOP_WINDOW_REGISTRY_KEY = 'keystone.desktop.window-registry.v1';
export const DESKTOP_WINDOW_REGISTRY_QUARANTINE_KEY = 'keystone.desktop.window-registry.quarantine.v1';
export const PRIMARY_DESKTOP_WINDOW_ID = 'main';
export const DESKTOP_QUICK_CAPTURE_EVENT = 'keystone:open-quick-capture';
const MAX_CLOSED_TABS = 32;
const MAX_NAVIGATION = 100;
const MAX_SPLIT_DEPTH = 3;
const SINGLETON_TAB_KEYS = new Set([
  'home:home',
  'settings:settings',
  'settings:search',
  'settings:device',
  'settings:customize',
  'settings:continuity',
  'settings:nearby',
  'settings:plugins',
  'music:music',
  'video:video',
  'shorts:shorts',
  'ai:ai',
  'network:network',
  'tasks:tasks',
  'document:documents',
  'document:document',
  'file:files',
  'file:file',
  'inbox:inbox',
  'map:map',
  'mail:mail',
  'media:photos',
  'media:calls',
  'subscriptions:subscriptions',
  'web-library:web-library',
]);
const KNOWN_OBJECT_KINDS = new Set<DesktopObjectKind>([
  'home',
  'inbox',
  'agent',
  'chat',
  'profile',
  'community',
  'space',
  'vault',
  'graph',
  'canvas',
  'calendar',
  'tasks',
  'contacts',
  'map',
  'mail',
  'file',
  'document',
  'music',
  'playlist',
  'video',
  'shorts',
  'ai',
  'network',
  'publication',
  'workboard',
  'subscriptions',
  'web-library',
  'settings',
  'browser',
  'media',
  'capture',
]);
const LEGACY_DEMO_IDS = new Set(['agent-bot', 'profile-bob', 'chat-bob', 'file-trip-plan', 'space-trip', 'agent-orbit', 'file-shared', 'space-chat', 'chat-file', 'space-file']);
const ACTIVITY_ITEM_IDS = new Set(['home', 'search', 'music', 'video', 'shorts', 'ai', 'network', 'capture', 'tasks', 'document', 'device', 'settings', 'inbox', 'agent', 'chat', 'space', 'vault', 'graph', 'canvas', 'calendar', 'contacts', 'map', 'mail', 'file', 'media', 'calls', 'workboard', 'subscriptions', 'web-library', 'continuity', 'nearby', 'plugins']);

let sequence = 0;
function id(prefix: string): string {
  sequence += 1;
  const random = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID().slice(0, 8) : `${Date.now().toString(36)}-${sequence.toString(36)}`;
  return `${prefix}-${random}`;
}

function now(): number {
  return Date.now();
}

export function createTabId(kind: DesktopObjectKind): string {
  return id(`tab-${kind}`);
}

export function createPaneId(): string {
  return id('pane');
}

export function createWorkspaceId(): string {
  return id('workspace');
}

export function objectTitle(ref: KeystoneObjectReference): string {
  if (ref.label?.trim()) return ref.label.trim().slice(0, 120);
  const labels: Record<DesktopObjectKind, string> = {
    home: 'Home',
    inbox: 'Inbox',
    agent: 'Agent Bot',
    chat: 'Chat',
    profile: 'Profile',
    community: 'Community',
    space: 'Space',
    vault: 'Vault',
    graph: 'Vault Graph',
    canvas: 'Canvas',
    calendar: 'Calendar',
    tasks: 'Tasks',
    contacts: 'Contacts',
    map: 'Maps',
    mail: 'External Email',
    file: 'File',
    document: 'Documents',
    music: 'Music',
    playlist: 'Playlist',
    video: 'Video',
    shorts: 'Shorts',
    ai: 'Local AI',
    network: 'Connectivity',
    publication: 'Publication',
    workboard: 'Workboard',
    subscriptions: 'Subscriptions',
    'web-library': 'Web Library',
    settings: 'Settings',
    browser: 'Browser',
    media: 'Media',
    capture: 'Quick Capture',
    unknown: 'Keystone object',
  };
  return labels[ref.kind] ?? 'Keystone object';
}

export function tabForReference(ref: KeystoneObjectReference, options: Partial<Pick<DesktopTab, 'pinned' | 'dirty'>> = {}): DesktopTab {
  return {
    id: createTabId(ref.kind),
    kind: ref.kind,
    title: objectTitle(ref),
    object: { ...ref, label: ref.label?.slice(0, 120) },
    pinned: options.pinned ?? false,
    dirty: options.dirty ?? false,
    createdAt: now(),
  };
}

export function browserTab(url: string, title = 'Browser', browserSessionId?: string): DesktopTab {
  return { id: createTabId('browser'), kind: 'browser', title: title.slice(0, 120), url, ...(browserSessionId ? { browserSessionId } : {}), browserActivity: 'IDLE', pinned: false, dirty: false, createdAt: now() };
}

export function defaultActivityBar(): ActivityBarItem[] {
  return [
    { id: 'home', kind: 'home', label: 'Home', icon: 'home', visible: true, pinned: true },
    { id: 'search', kind: 'search', label: 'Search', icon: 'search', visible: true, pinned: true },
    { id: 'music', kind: 'music', label: 'Music', icon: 'rss', visible: true, pinned: true },
    { id: 'video', kind: 'video', label: 'Video', icon: 'play', visible: true, pinned: true },
    { id: 'shorts', kind: 'shorts', label: 'Shorts', icon: 'play', visible: false, pinned: false },
    { id: 'ai', kind: 'ai', label: 'Local AI', icon: 'bot', visible: false, pinned: false },
    { id: 'network', kind: 'network', label: 'Connectivity', icon: 'network', visible: false, pinned: false },
    { id: 'capture', kind: 'capture', label: 'Quick Capture', icon: 'capture', visible: true, pinned: true },
    { id: 'tasks', kind: 'tasks', label: 'Tasks', icon: 'task', visible: true, pinned: true },
    { id: 'document', kind: 'document', label: 'Documents', icon: 'document', visible: true, pinned: true },
    { id: 'device', kind: 'settings', label: 'Device', icon: 'device', visible: false, pinned: false },
    { id: 'settings', kind: 'settings', label: 'Settings', icon: 'settings', visible: true, pinned: false },
    { id: 'inbox', kind: 'inbox', label: 'Inbox', icon: 'inbox', visible: false, pinned: false },
    { id: 'agent', kind: 'agent', label: 'Agent Bot', icon: 'bot', visible: false, pinned: false },
    { id: 'chat', kind: 'chat', label: 'Messages', icon: 'message', visible: false, pinned: false },
    { id: 'space', kind: 'space', label: 'Spaces', icon: 'spaces', visible: false, pinned: false },
    { id: 'vault', kind: 'vault', label: 'Vault', icon: 'vault', visible: false, pinned: false },
    { id: 'graph', kind: 'graph', label: 'Graph', icon: 'graph', visible: false, pinned: false },
    { id: 'canvas', kind: 'canvas', label: 'Canvas', icon: 'canvas', visible: false, pinned: false },
    { id: 'calendar', kind: 'calendar', label: 'Calendar', icon: 'calendar', visible: false, pinned: false },
    { id: 'contacts', kind: 'contacts', label: 'Contacts', icon: 'contacts', visible: false, pinned: false },
    { id: 'map', kind: 'map', label: 'Maps', icon: 'map', visible: false, pinned: false },
    { id: 'mail', kind: 'mail', label: 'External Email', icon: 'mail', visible: false, pinned: false },
    { id: 'file', kind: 'file', label: 'Files', icon: 'files', visible: false, pinned: false },
    { id: 'media', kind: 'media', label: 'Photos', icon: 'image', visible: false, pinned: false },
    { id: 'calls', kind: 'media', label: 'Calls', icon: 'phone', visible: false, pinned: false },
    { id: 'workboard', kind: 'workboard', label: 'Workboard', icon: 'board', visible: false, pinned: false },
    { id: 'subscriptions', kind: 'subscriptions', label: 'Subscriptions', icon: 'rss', visible: false, pinned: false },
    { id: 'web-library', kind: 'web-library', label: 'Web Library', icon: 'book-open', visible: false, pinned: false },
    { id: 'continuity', kind: 'settings', label: 'Continuity', icon: 'device', visible: false, pinned: false },
    { id: 'nearby', kind: 'settings', label: 'Nearby Exchange', icon: 'nearby', visible: false, pinned: false },
    { id: 'plugins', kind: 'plugins', label: 'Plugins', icon: 'plugins', visible: false, pinned: false, extensionSlot: true },
  ];
}

export function defaultPaneTree(): PaneNode {
  const home = tabForReference({ kind: 'home', id: 'home', label: 'Home' }, { pinned: true });
  // Keep the initial layout compact: the shell can split it without creating
  // a second model or copying either object.
  return { type: 'leaf', id: createPaneId(), tabIds: [home.id], activeTabId: home.id };
}

function defaultRecord(name = 'Personal'): WorkspaceRecord {
  const home = tabForReference({ kind: 'home', id: 'home', label: 'Home' }, { pinned: true });
  const paneTree: PaneNode = { type: 'leaf', id: createPaneId(), tabIds: [home.id], activeTabId: home.id };
  return {
    id: createWorkspaceId(),
    name,
    tabs: [home],
    closedTabs: [],
    paneTree,
    activePaneId: paneTree.id,
    chrome: defaultWorkspaceChrome(),
    updatedAt: now(),
  };
}

function defaultWorkspaceChrome(): WorkspaceChromeState {
  return { contextSidebarOpen: false, agentPanelOpen: false, activityBar: defaultActivityBar(), contextSidebarWidth: 280, agentPanelWidth: 360 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeKind(value: unknown): DesktopObjectKind {
  return typeof value === 'string' && KNOWN_OBJECT_KINDS.has(value as DesktopObjectKind) ? (value as DesktopObjectKind) : 'unknown';
}

function safeVisibility(value: unknown): DesktopVisibility | undefined {
  return value === 'public' || value === 'contacts' || value === 'community' || value === 'private' ? value : undefined;
}

function parseDesktopStartup(value: unknown): DesktopStartupPreference {
  if (!isRecord(value)) return { version: 1, surface: 'last-opened' };
  const allowed: readonly DesktopStartupSurface[] = ['last-opened', 'home', 'feed', 'video', 'messages', 'storage', 'calendar', 'map', 'mail', 'vault', 'workspace'];
  const surface = allowed.includes(value.surface as DesktopStartupSurface) ? value.surface as DesktopStartupSurface : 'last-opened';
  const target = sanitizeRef(value.target);
  return { version: 1, surface, ...(target ? { target } : {}) };
}

function readDesktopStartup(storage: DesktopStorage): DesktopStartupPreference {
  try { const raw = storage.getItem(STARTUP_SURFACE_KEY); return raw ? parseDesktopStartup(JSON.parse(raw)) : { version: 1, surface: 'last-opened' }; } catch { return { version: 1, surface: 'last-opened' }; }
}

/** Remove credentials and common secret query parameters before persistence. */
export function sanitizeUrlForPersistence(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    const secretKeys = /token|secret|password|passwd|key|auth|credential|session/i;
    for (const key of [...parsed.searchParams.keys()]) if (secretKeys.test(key)) parsed.searchParams.delete(key);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function safeBrowserOrigin(value: string): string {
  try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : ''; } catch { return ''; }
}

function sanitizeRef(value: unknown): KeystoneObjectReference | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return undefined;
  const ref: KeystoneObjectReference = { kind: safeKind(value.kind), id: value.id.slice(0, 256) };
  if (typeof value.query === 'string' && value.query.trim()) ref.query = value.query.trim().slice(0, 256);
  if (ref.kind === 'publication' && typeof value.revisionAddress === 'string' && /^sha256-[a-f0-9]{64}$/i.test(value.revisionAddress)) ref.revisionAddress = value.revisionAddress;
  if (typeof value.label === 'string') ref.label = value.label.slice(0, 120);
  const visibility = safeVisibility(value.visibility);
  if (visibility) ref.visibility = visibility;
  return ref;
}

function sanitizeTab(value: unknown): DesktopTab | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') return undefined;
  if (LEGACY_DEMO_IDS.has(value.id)) return undefined;
  const kind = safeKind(value.kind);
  const tab: DesktopTab = {
    id: value.id.slice(0, 128),
    kind,
    title: value.title.trim().slice(0, 120),
    pinned: value.pinned === true,
    dirty: value.dirty === true,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now(),
  };
  const ref = sanitizeRef(value.object);
  if (ref && LEGACY_DEMO_IDS.has(ref.id)) return undefined;
  if (ref) {
    tab.object = ref;
    // The reference is the source of truth for a rendered object surface.
    // Repair stale sessions where an old tab kind disagreed with its route.
    tab.kind = ref.kind;
    if (!tab.title) tab.title = objectTitle(ref);
  }
  const url = sanitizeUrlForPersistence(typeof value.url === 'string' ? value.url : undefined);
  if (url) tab.url = url;
  if (typeof value.browserSessionId === 'string' && value.browserSessionId.length <= 256 && !/[\u0000-\u001f]/.test(value.browserSessionId)) tab.browserSessionId = value.browserSessionId;
  if (typeof value.browserPageRevision === 'number' && Number.isSafeInteger(value.browserPageRevision) && value.browserPageRevision >= 0) tab.browserPageRevision = value.browserPageRevision;
  if (typeof value.browserOrigin === 'string' && /^https?:\/\//i.test(value.browserOrigin) && value.browserOrigin.length <= 512) tab.browserOrigin = value.browserOrigin;
  if (value.browserDataClass === 'PUBLIC' || value.browserDataClass === 'USER_EXPLICIT' || value.browserDataClass === 'PRIVATE' || value.browserDataClass === 'SECRET') tab.browserDataClass = value.browserDataClass;
  if (value.browserActivity === 'IDLE' || value.browserActivity === 'OBSERVING' || value.browserActivity === 'NAVIGATING' || value.browserActivity === 'ACTING' || value.browserActivity === 'WAITING' || value.browserActivity === 'PAUSED' || value.browserActivity === 'NEEDS_CONFIRMATION' || value.browserActivity === 'FAILED') tab.browserActivity = value.browserActivity;
  if (value.locked === true) tab.locked = true;
  if (!tab.title || tab.kind === 'unknown' || (!tab.object && tab.kind !== 'browser')) return undefined;
  return tab;
}

function singletonTabKey(tab: DesktopTab): string | undefined {
  if (!tab.object) return undefined;
  const key = `${tab.object.kind}:${tab.object.id}`;
  return SINGLETON_TAB_KEYS.has(key) ? key : undefined;
}

/**
 * Repair session presentation state without touching the object stores. Old
 * builds could leave duplicate singleton routes, duplicate tab ids, or a
 * persistent Quick Capture tray behind. These are tabs only; removing them
 * cannot remove owner data, tasks, documents, or captured payloads.
 */
function normalizeSessionTabs(tabs: DesktopTab[], closedTabs: DesktopTab[]): { tabs: DesktopTab[]; closedTabs: DesktopTab[] } {
  const active: DesktopTab[] = [];
  const closed: DesktopTab[] = [];
  const seenIds = new Set<string>();
  const seenSingletons = new Set<string>();
  const append = (tab: DesktopTab, target: DesktopTab[]): void => {
    if (seenIds.has(tab.id) || tab.kind === 'unknown') return;
    // Quick Capture is an overlay. A legacy persistent tray tab is only a
    // stale presentation record; captured items remain in CaptureService.
    if (tab.kind === 'capture' && tab.object?.id === 'capture') return;
    const singleton = singletonTabKey(tab);
    if (singleton && seenSingletons.has(singleton)) return;
    seenIds.add(tab.id);
    if (singleton) seenSingletons.add(singleton);
    target.push(tab);
  };
  for (const tab of tabs) append(tab, active);
  for (const tab of closedTabs) append(tab, closed);
  return { tabs: active.slice(0, 100), closedTabs: closed.slice(0, MAX_CLOSED_TABS) };
}

function sanitizePane(value: unknown): PaneNode | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || (value.type !== 'leaf' && value.type !== 'split')) return undefined;
  if (value.type === 'leaf') {
    const ids = Array.isArray(value.tabIds) ? value.tabIds.filter((entry): entry is string => typeof entry === 'string').slice(0, 100) : [];
    const active = typeof value.activeTabId === 'string' && ids.includes(value.activeTabId) ? value.activeTabId : ids[0];
    return { type: 'leaf', id: value.id.slice(0, 128), tabIds: ids, ...(active ? { activeTabId: active } : {}) };
  }
  const first = sanitizePane(value.first);
  const second = sanitizePane(value.second);
  if (!first || !second || (value.orientation !== 'horizontal' && value.orientation !== 'vertical')) return undefined;
  const ratio = typeof value.ratio === 'number' && Number.isFinite(value.ratio) ? Math.max(0.2, Math.min(0.8, value.ratio)) : 0.5;
  return { type: 'split', id: value.id.slice(0, 128), orientation: value.orientation, ratio, first, second };
}

function sanitizeActivityBar(value: unknown): ActivityBarItem[] {
  if (!Array.isArray(value)) return defaultActivityBar();
  const canonicalIcons = new Map(defaultActivityBar().map(item => [item.id, item.icon]));
  const seen = new Set<string>();
  const items = value.flatMap(entry => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.label !== 'string' || typeof entry.icon !== 'string' || seen.has(entry.id)) return [];
    seen.add(entry.id);
    if (!ACTIVITY_ITEM_IDS.has(entry.id)) return [];
    const item: ActivityBarItem = { id: entry.id.slice(0, 80), kind: entry.kind === 'search' || entry.kind === 'plugins' ? entry.kind : safeKind(entry.kind), label: entry.label.slice(0, 80), icon: canonicalIcons.get(entry.id) ?? entry.icon.slice(0, 32), visible: entry.visible !== false, pinned: entry.pinned === true };
    if (entry.extensionSlot === true) item.extensionSlot = true;
    return [item];
  });
  for (const fallback of defaultActivityBar()) if (!seen.has(fallback.id)) items.push(fallback);
  return items.length ? items.slice(0, 32) : defaultActivityBar();
}

function sanitizeRecord(value: unknown): WorkspaceRecord | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return undefined;
  const rawTabs = Array.isArray(value.tabs) ? value.tabs.flatMap(tab => { const safe = sanitizeTab(tab); return safe ? [safe] : []; }) : [];
  const rawClosedTabs = Array.isArray(value.closedTabs) ? value.closedTabs.flatMap(tab => { const safe = sanitizeTab(tab); return safe ? [safe] : []; }) : [];
  const normalized = normalizeSessionTabs(rawTabs, rawClosedTabs);
  const tabs = normalized.tabs;
  const closedTabs = normalized.closedTabs;
  const paneTree = sanitizePane(value.paneTree);
  if (!paneTree) return undefined;
  const tabIds = new Set(tabs.map(tab => tab.id));
  const cleanTree = filterPaneTabs(paneTree, tabIds);
  const leaf = firstLeaf(cleanTree);
  const chromeRecord = isRecord(value.chrome) ? value.chrome : {};
  return {
    id: value.id.slice(0, 128),
    name: value.name.slice(0, 80) || 'Personal',
    tabs,
    closedTabs,
    paneTree: cleanTree,
    activePaneId: typeof value.activePaneId === 'string' && findLeaf(cleanTree, value.activePaneId) ? value.activePaneId : leaf.id,
    chrome: {
      contextSidebarOpen: chromeRecord.contextSidebarOpen === true,
      agentPanelOpen: chromeRecord.agentPanelOpen === true,
      activityBar: sanitizeActivityBar(chromeRecord.activityBar),
      contextSidebarWidth: boundedWidth(chromeRecord.contextSidebarWidth, 280),
      agentPanelWidth: boundedWidth(chromeRecord.agentPanelWidth, 360),
    },
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now(),
  };
}

function boundedWidth(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(220, Math.min(520, value)) : fallback;
}

function filterPaneTabs(node: PaneNode, validIds: Set<string>): PaneNode {
  if (node.type === 'leaf') {
    const tabIds = node.tabIds.filter(tabId => validIds.has(tabId));
    const activeTabId = node.activeTabId && tabIds.includes(node.activeTabId) ? node.activeTabId : tabIds[0];
    return { type: 'leaf', id: node.id, tabIds, ...(activeTabId ? { activeTabId } : {}) };
  }
  return { ...node, first: filterPaneTabs(node.first, validIds), second: filterPaneTabs(node.second, validIds) };
}

function paneTreeForTabs(tabs: DesktopTab[]): PaneNode {
  const tabIds = tabs.map(tab => tab.id);
  return { type: 'leaf', id: createPaneId(), tabIds, ...(tabIds[0] ? { activeTabId: tabIds[0] } : {}) };
}

function firstLeaf(node: PaneNode): Extract<PaneNode, { type: 'leaf' }> {
  return node.type === 'leaf' ? node : firstLeaf(node.first);
}

function findLeaf(node: PaneNode, paneId: string): Extract<PaneNode, { type: 'leaf' }> | undefined {
  if (node.type === 'leaf') return node.id === paneId ? node : undefined;
  return findLeaf(node.first, paneId) ?? findLeaf(node.second, paneId);
}

function clonePane(node: PaneNode): PaneNode {
  return node.type === 'leaf' ? { ...node, tabIds: [...node.tabIds] } : { ...node, first: clonePane(node.first), second: clonePane(node.second) };
}

export class TabManager {
  private tabsById: Map<string, DesktopTab>;
  private order: string[];
  private closed: DesktopTab[];

  constructor(tabs: DesktopTab[] = [], closed: DesktopTab[] = []) {
    this.tabsById = new Map(tabs.map(tab => [tab.id, { ...tab, object: tab.object ? { ...tab.object } : undefined }]));
    this.order = tabs.map(tab => tab.id);
    this.closed = closed.slice(0, MAX_CLOSED_TABS);
  }

  list(): DesktopTab[] { return this.order.flatMap(tabId => { const tab = this.tabsById.get(tabId); return tab ? [{ ...tab, object: tab.object ? { ...tab.object } : undefined }] : []; }); }
  get(tabId: string): DesktopTab | undefined { const tab = this.tabsById.get(tabId); return tab ? { ...tab, object: tab.object ? { ...tab.object } : undefined } : undefined; }
  update(tabId: string, patch: Partial<DesktopTab>): boolean { const tab = this.tabsById.get(tabId); if (!tab) return false; Object.assign(tab, patch); return true; }
  get closedTabs(): DesktopTab[] { return this.closed.map(tab => ({ ...tab, object: tab.object ? { ...tab.object } : undefined })); }

  open(tab: DesktopTab, allowDuplicate = false): DesktopTab {
    const existing = !allowDuplicate && tab.object ? this.list().find(candidate => candidate.object?.kind === tab.object?.kind && candidate.object?.id === tab.object?.id) : undefined;
    if (existing) return existing;
    const next = { ...tab, id: tab.id || createTabId(tab.kind), createdAt: tab.createdAt || now(), object: tab.object ? { ...tab.object } : undefined };
    this.tabsById.set(next.id, next);
    this.order.push(next.id);
    return { ...next, object: next.object ? { ...next.object } : undefined };
  }

  close(tabId: string): DesktopTab | undefined {
    const tab = this.tabsById.get(tabId);
    if (!tab || tab.pinned) return undefined;
    this.tabsById.delete(tabId);
    this.order = this.order.filter(idValue => idValue !== tabId);
    this.closed.unshift({ ...tab, object: tab.object ? { ...tab.object } : undefined });
    this.closed = this.closed.slice(0, MAX_CLOSED_TABS);
    return { ...tab, object: tab.object ? { ...tab.object } : undefined };
  }

  forceClose(tabId: string): DesktopTab | undefined {
    const tab = this.tabsById.get(tabId);
    if (!tab) return undefined;
    this.tabsById.delete(tabId);
    this.order = this.order.filter(idValue => idValue !== tabId);
    this.closed.unshift({ ...tab, object: tab.object ? { ...tab.object } : undefined });
    this.closed = this.closed.slice(0, MAX_CLOSED_TABS);
    return { ...tab, object: tab.object ? { ...tab.object } : undefined };
  }

  /** Remove a tab from the current window without placing it in Reopen. */
  take(tabId: string): DesktopTab | undefined {
    const tab = this.tabsById.get(tabId);
    if (!tab) return undefined;
    this.tabsById.delete(tabId);
    this.order = this.order.filter(idValue => idValue !== tabId);
    return { ...tab, object: tab.object ? { ...tab.object } : undefined };
  }

  findByReference(ref: KeystoneObjectReference): DesktopTab | undefined {
    return this.list().find(tab => tab.object?.kind === ref.kind && tab.object.id === ref.id);
  }

  reopen(): DesktopTab | undefined {
    const tab = this.closed.shift();
    if (!tab) return undefined;
    this.tabsById.set(tab.id, tab);
    this.order.push(tab.id);
    return { ...tab, object: tab.object ? { ...tab.object } : undefined };
  }

  /** Explicit restore alias used by hosts that present a Reopen/Restore action. */
  restore(tab?: DesktopTab): DesktopTab | undefined {
    if (tab) {
      const restored = this.open({ ...tab, object: tab.object ? { ...tab.object } : undefined }, true);
      this.closed = this.closed.filter(candidate => candidate.id !== tab.id);
      return restored;
    }
    return this.reopen();
  }

  duplicate(tabId: string): DesktopTab | undefined {
    const tab = this.tabsById.get(tabId);
    if (!tab) return undefined;
    return this.open({ ...tab, id: createTabId(tab.kind), pinned: false, dirty: false, createdAt: now(), object: tab.object ? { ...tab.object } : undefined }, true);
  }

  pin(tabId: string, pinned = true): boolean {
    const tab = this.tabsById.get(tabId);
    if (!tab) return false;
    tab.pinned = pinned;
    return true;
  }

  dirty(tabId: string, dirty = true): boolean {
    const tab = this.tabsById.get(tabId);
    if (!tab) return false;
    tab.dirty = dirty;
    return true;
  }

  lock(tabId: string, locked = true): boolean {
    const tab = this.tabsById.get(tabId);
    if (!tab) return false;
    tab.locked = locked;
    return true;
  }

  reorder(tabId: string, targetIndex: number): boolean {
    const currentIndex = this.order.indexOf(tabId);
    if (currentIndex < 0) return false;
    const tab = this.tabsById.get(tabId);
    if (!tab) return false;
    this.order.splice(currentIndex, 1);
    const pinnedCount = this.order.filter(idValue => this.tabsById.get(idValue)?.pinned).length;
    const lowerBound = tab.pinned ? 0 : pinnedCount;
    const upperBound = tab.pinned ? pinnedCount : this.order.length;
    this.order.splice(Math.max(lowerBound, Math.min(upperBound, targetIndex)), 0, tabId);
    return true;
  }

  next(tabId: string, direction: 1 | -1): DesktopTab | undefined {
    const index = this.order.indexOf(tabId);
    if (index < 0 || this.order.length === 0) return undefined;
    return this.get(this.order[(index + direction + this.order.length) % this.order.length]);
  }
}

export class PaneManager {
  private root: PaneNode;

  constructor(root: PaneNode) { this.root = clonePane(root); }
  get tree(): PaneNode { return clonePane(this.root); }
  get leaves(): Array<Extract<PaneNode, { type: 'leaf' }>> { const result: Array<Extract<PaneNode, { type: 'leaf' }>> = []; walkLeaves(this.root, result); return result.map(leaf => ({ ...leaf, tabIds: [...leaf.tabIds] })); }
  leaf(paneId: string): Extract<PaneNode, { type: 'leaf' }> | undefined { const found = findLeaf(this.root, paneId); return found ? { ...found, tabIds: [...found.tabIds] } : undefined; }
  findTabOwner(tabId: string): string | undefined { return this.leaves.find(leaf => leaf.tabIds.includes(tabId))?.id; }

  addTab(paneId: string, tabId: string, activate = true): boolean {
    let changed = false;
    this.root = updatePane(this.root, paneId, node => {
      if (node.type !== 'leaf') return node;
      if (!node.tabIds.includes(tabId)) node.tabIds.push(tabId);
      if (activate) node.activeTabId = tabId;
      changed = true;
      return node;
    });
    return changed;
  }

  removeTab(tabId: string): string | undefined {
    let owner: string | undefined;
    this.root = updateEveryPane(this.root, node => {
      if (node.type !== 'leaf') return node;
      if (!node.tabIds.includes(tabId)) return node;
      owner = owner ?? node.id;
      node.tabIds = node.tabIds.filter(idValue => idValue !== tabId);
      if (node.activeTabId === tabId) node.activeTabId = node.tabIds[0];
      return node;
    });
    return owner;
  }

  setActiveTab(paneId: string, tabId: string): boolean {
    let changed = false;
    this.root = updatePane(this.root, paneId, node => {
      if (node.type !== 'leaf' || !node.tabIds.includes(tabId)) return node;
      node.activeTabId = tabId;
      changed = true;
      return node;
    });
    return changed;
  }

  split(paneId: string, orientation: PaneOrientation): string | undefined {
    if (treeDepth(this.root) >= MAX_SPLIT_DEPTH) return undefined;
    const newPaneId = createPaneId();
    let changed = false;
    this.root = replacePane(this.root, paneId, node => {
      if (node.type !== 'leaf') return node;
      changed = true;
      return { type: 'split', id: createPaneId(), orientation, ratio: 0.5, first: node, second: { type: 'leaf', id: newPaneId, tabIds: [] } };
    });
    return changed ? newPaneId : undefined;
  }

  close(paneId: string): boolean {
    if (this.root.type === 'leaf') return false;
    const next = removePane(this.root, paneId);
    if (!next) return false;
    this.root = next;
    return true;
  }

  moveTab(tabId: string, toPaneId: string): boolean {
    if (!this.leaf(toPaneId)) return false;
    const from = this.removeTab(tabId);
    if (!from) return false;
    return this.addTab(toPaneId, tabId, true);
  }

  resize(splitId: string, ratio: number): boolean {
    let changed = false;
    this.root = updateSplit(this.root, splitId, node => { changed = true; return { ...node, ratio: Math.max(0.2, Math.min(0.8, ratio)) }; });
    return changed;
  }

  firstPaneId(): string { return firstLeaf(this.root).id; }
}

function walkLeaves(node: PaneNode, output: Array<Extract<PaneNode, { type: 'leaf' }>>): void {
  if (node.type === 'leaf') output.push(node);
  else { walkLeaves(node.first, output); walkLeaves(node.second, output); }
}

function treeDepth(node: PaneNode): number { return node.type === 'leaf' ? 1 : 1 + Math.max(treeDepth(node.first), treeDepth(node.second)); }

function updatePane(node: PaneNode, paneId: string, update: (node: PaneNode) => PaneNode): PaneNode {
  if (node.type === 'leaf') return node.id === paneId ? update(node) : node;
  return { ...node, first: updatePane(node.first, paneId, update), second: updatePane(node.second, paneId, update) };
}

function updateEveryPane(node: PaneNode, update: (node: PaneNode) => PaneNode): PaneNode {
  if (node.type === 'leaf') return update(node);
  return { ...node, first: updateEveryPane(node.first, update), second: updateEveryPane(node.second, update) };
}

function replacePane(node: PaneNode, paneId: string, replace: (node: PaneNode) => PaneNode): PaneNode {
  if (node.type === 'leaf') return node.id === paneId ? replace(node) : node;
  return { ...node, first: replacePane(node.first, paneId, replace), second: replacePane(node.second, paneId, replace) };
}

function updateSplit(node: PaneNode, splitId: string, update: (node: Extract<PaneNode, { type: 'split' }>) => PaneNode): PaneNode {
  if (node.type === 'leaf') return node;
  if (node.id === splitId) return update(node);
  return { ...node, first: updateSplit(node.first, splitId, update), second: updateSplit(node.second, splitId, update) };
}

function removePane(node: PaneNode, paneId: string): PaneNode | undefined {
  if (node.type === 'leaf') return node.id === paneId ? undefined : node;
  if (node.first.type === 'leaf' && node.first.id === paneId) return node.second;
  if (node.second.type === 'leaf' && node.second.id === paneId) return node.first;
  const first = removePane(node.first, paneId);
  if (!first) return node.second;
  const second = removePane(node.second, paneId);
  if (!second) return first;
  return { ...node, first, second };
}

export interface NavigationEntry {
  id: string;
  tabId?: string;
  ref?: KeystoneObjectReference;
  url?: string;
  title: string;
}

export class DesktopNavigation {
  private entries: NavigationEntry[] = [];
  private cursor = -1;

  constructor(entries: NavigationEntry[] = []) {
    this.entries = entries.slice(-MAX_NAVIGATION).map(entry => ({ ...entry, ref: entry.ref ? { ...entry.ref } : undefined, url: sanitizeUrlForPersistence(entry.url) }));
    this.cursor = this.entries.length - 1;
  }

  list(): NavigationEntry[] { return this.entries.map(entry => ({ ...entry, ref: entry.ref ? { ...entry.ref } : undefined })); }
  current(): NavigationEntry | undefined { return this.entries[this.cursor]; }

  push(entry: Omit<NavigationEntry, 'id'>): void {
    const next = { ...entry, id: id('nav'), ref: entry.ref ? { ...entry.ref } : undefined, url: sanitizeUrlForPersistence(entry.url) };
    const current = this.entries[this.cursor];
    if (current && sameNavigation(current, next)) return;
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push(next);
    if (this.entries.length > MAX_NAVIGATION) this.entries.shift();
    this.cursor = this.entries.length - 1;
  }

  back(): NavigationEntry | undefined { if (this.cursor <= 0) return undefined; this.cursor -= 1; return this.current(); }
  forward(): NavigationEntry | undefined { if (this.cursor >= this.entries.length - 1) return undefined; this.cursor += 1; return this.current(); }
}

function sameNavigation(a: NavigationEntry, b: NavigationEntry): boolean {
  return a.tabId === b.tabId && a.url === b.url && a.ref?.kind === b.ref?.kind && a.ref?.id === b.ref?.id;
}

export interface WorkspaceStorageEnvelope {
  version: 1;
  currentId: string;
  workspaces: WorkspaceRecord[];
}

export class WorkspaceManager {
  private records: Map<string, WorkspaceRecord>;
  private currentId: string;
  private storage: DesktopStorage;

  constructor(storage: DesktopStorage = defaultStorage()) {
    this.storage = storage;
    const loaded = this.read();
    this.records = new Map(loaded.workspaces.map(record => [record.id, record]));
    this.currentId = this.records.has(loaded.currentId) ? loaded.currentId : loaded.workspaces[0].id;
    // Persist the sanitized envelope immediately so a stale session is
    // migrated once at the boundary and cannot be resurrected by a later
    // window or host process.
    this.write();
  }

  current(): WorkspaceRecord { return cloneRecord(this.records.get(this.currentId) ?? defaultRecord()); }
  list(): WorkspaceRecord[] { return [...this.records.values()].map(record => cloneRecord(record)); }

  save(record: WorkspaceRecord): void {
    const safe = sanitizeRecord(record) ?? defaultRecord(record.name);
    this.records.set(safe.id, safe);
    this.currentId = safe.id;
    this.write();
  }

  create(name: string, template = this.current()): WorkspaceRecord {
    const source = cloneRecord(template);
    const record: WorkspaceRecord = { ...source, id: createWorkspaceId(), name: name.trim().slice(0, 80) || 'Workspace', updatedAt: now() };
    this.records.set(record.id, record);
    this.currentId = record.id;
    this.write();
    return cloneRecord(record);
  }

  rename(workspaceId: string, name: string): boolean {
    const record = this.records.get(workspaceId);
    if (!record || !name.trim()) return false;
    record.name = name.trim().slice(0, 80);
    record.updatedAt = now();
    this.write();
    return true;
  }

  remove(workspaceId: string): boolean {
    if (!this.records.has(workspaceId) || this.records.size <= 1) return false;
    this.records.delete(workspaceId);
    if (this.currentId === workspaceId) this.currentId = this.records.keys().next().value as string;
    this.write();
    return true;
  }

  delete(workspaceId: string): boolean { return this.remove(workspaceId); }

  switch(workspaceId: string): WorkspaceRecord | undefined {
    if (!this.records.has(workspaceId)) return undefined;
    this.currentId = workspaceId;
    this.write();
    return this.current();
  }

  reload(): WorkspaceRecord {
    const loaded = this.read();
    this.records = new Map(loaded.workspaces.map(record => [record.id, record]));
    this.currentId = this.records.has(loaded.currentId) ? loaded.currentId : loaded.workspaces[0].id;
    this.write();
    return this.current();
  }

  private read(): WorkspaceStorageEnvelope {
    try {
      const raw = this.storage.getItem(WORKSPACES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isRecord(parsed) && parsed.version === 1 && Array.isArray(parsed.workspaces)) {
          const workspaces = parsed.workspaces.flatMap(entry => { const record = sanitizeRecord(entry); return record ? [record] : []; });
          if (workspaces.length) return { version: 1, currentId: typeof parsed.currentId === 'string' ? parsed.currentId : workspaces[0].id, workspaces };
        }
      }
    } catch {
      // Corrupted state is intentionally discarded and replaced with a safe
      // empty workspace.  No user object data is needed to restore the shell.
    }
    const fallback = defaultRecord();
    return { version: 1, currentId: fallback.id, workspaces: [fallback] };
  }

  private write(): void {
    const envelope: WorkspaceStorageEnvelope = { version: 1, currentId: this.currentId, workspaces: [...this.records.values()].map(record => sanitizeRecord(record) ?? record) };
    try {
      this.storage.setItem(WORKSPACES_KEY, JSON.stringify(envelope));
      this.storage.setItem(CURRENT_WORKSPACE_KEY, this.currentId);
    } catch {
      // Private browsing/storage quota failures should not break navigation.
    }
  }
}

function cloneWindowRecord(record: DesktopWindowRecord): DesktopWindowRecord {
  return {
    ...record,
    tabIds: [...record.tabIds],
    paneTree: record.paneTree ? clonePane(record.paneTree) : undefined,
    chrome: record.chrome ? JSON.parse(JSON.stringify(record.chrome)) as WorkspaceChromeState : undefined,
    geometry: record.geometry ? { ...record.geometry } : undefined,
  };
}

const WINDOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_QUARANTINED_WINDOW_STATE = 96_000;

function validateWindowGeometry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const validInteger = (candidate: unknown, minimum: number, maximum: number): boolean => typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= minimum && candidate <= maximum;
  if (!validInteger(value.width, 900, 10_000) || !validInteger(value.height, 600, 10_000)) return false;
  if (value.x !== undefined && !validInteger(value.x, -100_000, 100_000)) return false;
  if (value.y !== undefined && !validInteger(value.y, -100_000, 100_000)) return false;
  if (value.maximized !== undefined && typeof value.maximized !== 'boolean') return false;
  if (value.fullscreen !== undefined && typeof value.fullscreen !== 'boolean') return false;
  return true;
}

export interface DesktopWindowRegistryValidation {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Validate the raw versioned registry before any sanitizing repair can make a
 * stale native-window record look trustworthy. The canonical native primary
 * is always the Tauri `main` window; anything else is quarantined.
 */
export function validateDesktopWindowRegistry(value: unknown): DesktopWindowRegistryValidation {
  if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.windows)) return { ok: false, reason: 'unsupported-version-or-shape' };
  if (value.primaryWindowId !== PRIMARY_DESKTOP_WINDOW_ID) return { ok: false, reason: 'primary-window-is-not-main' };
  const ids = new Set<string>();
  const ownedTabs = new Set<string>();
  let primaryCount = 0;
  for (const entry of value.windows) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !WINDOW_ID_PATTERN.test(entry.id) || ids.has(entry.id)) return { ok: false, reason: 'duplicate-or-invalid-window-id' };
    if (typeof entry.workspaceId !== 'string' || !WINDOW_ID_PATTERN.test(entry.workspaceId)) return { ok: false, reason: 'invalid-workspace-id' };
    if (!Array.isArray(entry.tabIds)) return { ok: false, reason: 'invalid-tab-ownership-list' };
    const localTabs = new Set<string>();
    for (const tabId of entry.tabIds) {
      if (typeof tabId !== 'string' || !WINDOW_ID_PATTERN.test(tabId) || localTabs.has(tabId)) return { ok: false, reason: 'duplicate-or-invalid-tab-id' };
      localTabs.add(tabId);
      const ownershipKey = `${entry.workspaceId}:${tabId}`;
      if (ownedTabs.has(ownershipKey)) return { ok: false, reason: 'duplicate-tab-ownership' };
      ownedTabs.add(ownershipKey);
    }
    if (entry.id !== PRIMARY_DESKTOP_WINDOW_ID && entry.tabIds.length === 0) return { ok: false, reason: 'empty-secondary-window' };
    if (entry.id === PRIMARY_DESKTOP_WINDOW_ID && entry.primary !== true) return { ok: false, reason: 'main-is-not-primary' };
    if (entry.primary === true) primaryCount += 1;
    if (entry.updatedAt !== undefined && (typeof entry.updatedAt !== 'number' || !Number.isFinite(entry.updatedAt))) return { ok: false, reason: 'invalid-window-timestamp' };
    if (entry.geometry !== undefined && !validateWindowGeometry(entry.geometry)) return { ok: false, reason: 'impossible-window-geometry' };
    for (const transferKey of ['transfers', 'pendingTransfers', 'transferTransactions']) {
      if (Array.isArray(entry[transferKey]) && entry[transferKey].length > 0) return { ok: false, reason: 'stale-transfer-transaction' };
      if (entry[transferKey] !== undefined && !Array.isArray(entry[transferKey])) return { ok: false, reason: 'invalid-transfer-transaction-state' };
    }
    ids.add(entry.id);
  }
  if (value.windows.length > 0 && (primaryCount !== 1 || !ids.has(PRIMARY_DESKTOP_WINDOW_ID))) return { ok: false, reason: 'primary-window-count' };
  return { ok: true };
}

function sanitizeWindowGeometry(value: unknown): DesktopWindowGeometry | undefined {
  if (!isRecord(value)) return undefined;
  const width = typeof value.width === 'number' && Number.isFinite(value.width) ? Math.max(900, Math.min(10000, Math.round(value.width))) : 1280;
  const height = typeof value.height === 'number' && Number.isFinite(value.height) ? Math.max(600, Math.min(10000, Math.round(value.height))) : 800;
  const geometry: DesktopWindowGeometry = { width, height };
  if (typeof value.x === 'number' && Number.isFinite(value.x)) geometry.x = Math.round(value.x);
  if (typeof value.y === 'number' && Number.isFinite(value.y)) geometry.y = Math.round(value.y);
  if (value.maximized === true) geometry.maximized = true;
  if (value.fullscreen === true) geometry.fullscreen = true;
  return geometry;
}

function sanitizeWindowChrome(value: unknown): WorkspaceChromeState | undefined {
  if (!isRecord(value)) return undefined;
  return {
    contextSidebarOpen: value.contextSidebarOpen === true,
    agentPanelOpen: value.agentPanelOpen === true,
    activityBar: sanitizeActivityBar(value.activityBar),
    contextSidebarWidth: boundedWidth(value.contextSidebarWidth, 280),
    agentPanelWidth: boundedWidth(value.agentPanelWidth, 360),
  };
}

function sanitizeWindowRecord(value: unknown): DesktopWindowRecord | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.workspaceId !== 'string') return undefined;
  const tabIds = Array.isArray(value.tabIds)
    ? [...new Set(value.tabIds.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))].slice(0, 100)
    : [];
  const paneTree = sanitizePane(value.paneTree);
  const activeTabId = typeof value.activeTabId === 'string' && tabIds.includes(value.activeTabId) ? value.activeTabId : tabIds[0];
  const activePaneId = typeof value.activePaneId === 'string' ? value.activePaneId.slice(0, 128) : undefined;
  return {
    id: value.id.slice(0, 128),
    workspaceId: value.workspaceId.slice(0, 128),
    tabIds,
    ...(activeTabId ? { activeTabId } : {}),
    ...(paneTree ? { paneTree } : {}),
    ...(activePaneId ? { activePaneId } : {}),
    ...(sanitizeWindowChrome(value.chrome) ? { chrome: sanitizeWindowChrome(value.chrome) } : {}),
    ...(sanitizeWindowGeometry(value.geometry) ? { geometry: sanitizeWindowGeometry(value.geometry) } : {}),
    primary: value.primary === true,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now(),
  };
}

/**
 * Durable ownership map for native Keystone windows.  A workspace still
 * stores the canonical tab payloads; this registry only answers which native
 * window currently owns each tab and keeps window-local layout metadata.
 */
export class DesktopWindowRegistry {
  private envelope: DesktopWindowStorageEnvelope;
  private readonly storage: DesktopStorage;

  constructor(storage: DesktopStorage = defaultStorage()) {
    this.storage = storage;
    this.envelope = this.read();
  }

  reload(): void { this.envelope = this.read(); }

  list(workspaceId?: string): DesktopWindowRecord[] {
    return this.envelope.windows.filter(window => !workspaceId || window.workspaceId === workspaceId).map(cloneWindowRecord);
  }

  get(windowId: string): DesktopWindowRecord | undefined {
    const record = this.envelope.windows.find(window => window.id === windowId);
    return record ? cloneWindowRecord(record) : undefined;
  }

  get primaryWindowId(): string { return this.envelope.primaryWindowId; }

  /** Bring an older/partial registry up to date with the current workspace. */
  ensureWorkspace(workspace: WorkspaceRecord): DesktopWindowRecord {
    if (!this.validateWorkspaceState(workspace)) {
      this.quarantine(JSON.stringify(this.envelope), 'stale-or-invalid-workspace-ownership');
      this.envelope = { version: 2, primaryWindowId: PRIMARY_DESKTOP_WINDOW_ID, windows: [] };
    }
    const canonicalIds = new Set(workspace.tabs.map(tab => tab.id));
    let primary = this.envelope.windows.find(window => window.id === PRIMARY_DESKTOP_WINDOW_ID && window.primary);
    if (!primary) {
      primary = this.envelope.windows.find(window => window.primary);
    }
    if (!primary) {
      primary = {
        id: PRIMARY_DESKTOP_WINDOW_ID,
        workspaceId: workspace.id,
        tabIds: [],
        primary: true,
        updatedAt: now(),
      };
      this.envelope.windows.unshift(primary);
    }
    this.envelope.primaryWindowId = primary.id;
    primary.primary = true;
    primary.workspaceId = workspace.id;
    // A native secondary is only meaningful while it owns at least one tab.
    // Prune stale empty records left by a host close or an interrupted
    // transfer before rebuilding ownership, so restart can never recreate a
    // blank detached window.
    this.envelope.windows = this.envelope.windows.filter(window => window.workspaceId !== workspace.id || window.id === primary!.id || window.tabIds.length > 0);
    for (const window of this.envelope.windows) if (window.id !== primary.id && window.workspaceId === workspace.id) window.primary = false;
    primary.paneTree ??= clonePane(workspace.paneTree);
    primary.activePaneId ??= workspace.activePaneId;
    primary.chrome ??= JSON.parse(JSON.stringify(workspace.chrome)) as WorkspaceChromeState;

    const relevant = this.envelope.windows.filter(window => window.workspaceId === workspace.id);
    if (!relevant.includes(primary)) relevant.unshift(primary);
    const assigned = new Set<string>();
    for (const window of relevant) {
      const unique = window.tabIds.filter(tabId => canonicalIds.has(tabId) && !assigned.has(tabId));
      window.tabIds = unique;
      for (const tabId of unique) assigned.add(tabId);
      window.activeTabId = window.activeTabId && window.tabIds.includes(window.activeTabId) ? window.activeTabId : window.tabIds[0];
      window.updatedAt = now();
    }
    // Any tab not yet owned belongs to the primary window.  Preserve the
    // workspace order so a first launch is deterministic and calm.
    for (const tab of workspace.tabs) if (!assigned.has(tab.id)) { primary.tabIds.push(tab.id); assigned.add(tab.id); }
    primary.tabIds = [...new Set(primary.tabIds)];
    primary.activeTabId = primary.activeTabId && primary.tabIds.includes(primary.activeTabId) ? primary.activeTabId : primary.tabIds[0];
    if (primary.tabIds.length && !primary.paneTree) primary.paneTree = clonePane(workspace.paneTree);
    // The first pass above repairs ownership. Prune records that became empty
    // after invalid/stale tab ids were removed; otherwise a phantom native
    // window could be recreated on the next launch.
    this.envelope.windows = this.envelope.windows.filter(window => window.workspaceId !== workspace.id || window.id === primary!.id || window.tabIds.length > 0);
    this.write();
    return cloneWindowRecord(primary);
  }

  /** Keep the real tabs but collapse a previous multi-window session to main. */
  consolidateWorkspaceWindows(workspace: WorkspaceRecord): DesktopWindowRecord {
    const primary = this.ensureWorkspace(workspace);
    const record = this.envelope.windows.find(window => window.id === primary.id)!;
    record.tabIds = workspace.tabs.map(tab => tab.id);
    record.activeTabId = record.activeTabId && record.tabIds.includes(record.activeTabId) ? record.activeTabId : record.tabIds[0];
    record.updatedAt = now();
    this.envelope.windows = this.envelope.windows.filter(window => window.workspaceId !== workspace.id || window.id === record.id);
    this.envelope.primaryWindowId = record.id;
    this.write();
    return cloneWindowRecord(record);
  }

  /** Reset window/tab presentation state while leaving canonical tab content intact. */
  resetWorkspaceLayout(workspace: WorkspaceRecord): DesktopWindowRecord {
    const primary = this.ensureWorkspace(workspace);
    const record = this.envelope.windows.find(window => window.id === primary.id)!;
    const paneTree = paneTreeForTabs(workspace.tabs);
    record.tabIds = workspace.tabs.map(tab => tab.id);
    record.activeTabId = record.tabIds[0];
    record.paneTree = paneTree;
    record.activePaneId = paneTree.id;
    record.chrome = defaultWorkspaceChrome();
    record.updatedAt = now();
    this.envelope.windows = this.envelope.windows.filter(window => window.workspaceId !== workspace.id || window.id === record.id);
    this.envelope.primaryWindowId = record.id;
    this.write();
    return cloneWindowRecord(record);
  }

  prepareWindow(windowId: string, workspace: WorkspaceRecord, detachedTabId?: string): DesktopWindowRecord | undefined {
    this.ensureWorkspace(workspace);
    let record = this.envelope.windows.find(window => window.id === windowId && window.workspaceId === workspace.id);
    if (!record && windowId !== this.envelope.primaryWindowId && detachedTabId && workspace.tabs.some(tab => tab.id === detachedTabId)) {
      record = { id: windowId.slice(0, 128), workspaceId: workspace.id, tabIds: [], primary: false, updatedAt: now() };
      this.envelope.windows.push(record);
    }
    // A missing secondary record means that the native window was closed or
    // its last tab was accepted elsewhere. Never fall back to the primary
    // record here: doing so would make a stale secondary render the primary
    // window again instead of closing cleanly.
    if (!record) return windowId === this.envelope.primaryWindowId ? this.get(this.envelope.primaryWindowId) : undefined;
    if (detachedTabId && workspace.tabs.some(tab => tab.id === detachedTabId)) this.assignTab(workspace.id, detachedTabId, record.id, false);
    const refreshed = this.envelope.windows.find(window => window.id === record!.id) ?? record;
    refreshed.activeTabId = refreshed.activeTabId && refreshed.tabIds.includes(refreshed.activeTabId) ? refreshed.activeTabId : refreshed.tabIds[0];
    this.write();
    return cloneWindowRecord(refreshed);
  }

  ownerOf(workspaceId: string, tabId: string): DesktopWindowRecord | undefined {
    const owner = this.envelope.windows.find(window => window.workspaceId === workspaceId && window.tabIds.includes(tabId));
    return owner ? cloneWindowRecord(owner) : undefined;
  }

  ownerOfReference(workspaceId: string, workspace: WorkspaceRecord, ref: KeystoneObjectReference): DesktopWindowRecord | undefined {
    const tab = workspace.tabs.find(candidate => candidate.object?.kind === ref.kind && candidate.object.id === ref.id);
    return tab ? this.ownerOf(workspaceId, tab.id) : undefined;
  }

  createDetached(workspaceId: string, tabId: string, geometry?: DesktopWindowGeometry): DesktopWindowRecord | undefined {
    const owner = this.ownerOf(workspaceId, tabId);
    if (!owner) return undefined;
    const window: DesktopWindowRecord = {
      id: id('window'),
      workspaceId,
      tabIds: [tabId],
      activeTabId: tabId,
      geometry: geometry ? { ...geometry } : undefined,
      primary: false,
      updatedAt: now(),
    };
    const source = this.envelope.windows.find(candidate => candidate.id === owner.id);
    if (!source) return undefined;
    source.tabIds = source.tabIds.filter(candidate => candidate !== tabId);
    source.activeTabId = source.activeTabId === tabId ? source.tabIds[0] : source.activeTabId;
    this.envelope.windows.push(window);
    this.write();
    return cloneWindowRecord(window);
  }

  assignTab(workspaceId: string, tabId: string, targetWindowId: string, write = true): boolean {
    const target = this.envelope.windows.find(window => window.id === targetWindowId && window.workspaceId === workspaceId);
    if (!target) return false;
    let found = false;
    for (const window of this.envelope.windows) {
      if (window.workspaceId !== workspaceId) continue;
      const had = window.tabIds.includes(tabId);
      window.tabIds = window.tabIds.filter(candidate => candidate !== tabId);
      if (had) { found = true; if (window.activeTabId === tabId) window.activeTabId = window.tabIds[0]; }
    }
    if (!target.tabIds.includes(tabId)) target.tabIds.push(tabId);
    target.activeTabId = tabId;
    if (write) this.write();
    return found || target.tabIds.includes(tabId);
  }

  /**
   * Commit a cross-window move in one registry write.  The source ownership
   * is checked immediately before mutation; a stale drag cannot steal a tab
   * that another window has already moved.  No intermediate state is exposed
   * to a reload, so a tab is either owned by the source or by the target.
   */
  transferTabAt(workspaceId: string, tabId: string, sourceWindowId: string, targetWindowId: string, targetIndex = Number.MAX_SAFE_INTEGER): DesktopWindowTransferCommit | undefined {
    if (!tabId || sourceWindowId === targetWindowId) return undefined;
    const windows = this.envelope.windows.filter(window => window.workspaceId === workspaceId);
    const source = windows.find(window => window.id === sourceWindowId);
    const target = windows.find(window => window.id === targetWindowId);
    const owners = windows.filter(window => window.tabIds.includes(tabId));
    if (!source || !target || source === target || owners.length !== 1 || owners[0] !== source) return undefined;
    const sourceIndex = source.tabIds.indexOf(tabId);
    if (sourceIndex < 0) return undefined;
    source.tabIds.splice(sourceIndex, 1);
    source.activeTabId = source.activeTabId === tabId ? source.tabIds[0] : source.activeTabId;
    const insertion = Math.max(0, Math.min(target.tabIds.length, Number.isSafeInteger(targetIndex) ? targetIndex : target.tabIds.length));
    target.tabIds.splice(insertion, 0, tabId);
    target.activeTabId = tabId;
    source.updatedAt = now();
    target.updatedAt = now();
    this.write();
    return { workspaceId, tabId, sourceWindowId, targetWindowId, sourceIndex, targetIndex: insertion, source: cloneWindowRecord(source), target: cloneWindowRecord(target) };
  }

  /** Merge all source tabs with one atomic ownership write. */
  transferAllAt(workspaceId: string, sourceWindowId: string, targetWindowId: string): boolean {
    if (sourceWindowId === targetWindowId) return false;
    const windows = this.envelope.windows.filter(window => window.workspaceId === workspaceId);
    const source = windows.find(window => window.id === sourceWindowId);
    const target = windows.find(window => window.id === targetWindowId);
    if (!source || !target || source.primary || !source.tabIds.length) return false;
    const sourceIds = [...source.tabIds];
    const ownerCounts = new Map<string, number>();
    for (const window of windows) for (const tabId of window.tabIds) ownerCounts.set(tabId, (ownerCounts.get(tabId) ?? 0) + 1);
    if (sourceIds.some(tabId => ownerCounts.get(tabId) !== 1)) return false;
    source.tabIds = [];
    source.activeTabId = undefined;
    for (const tabId of sourceIds) if (!target.tabIds.includes(tabId)) target.tabIds.push(tabId);
    target.activeTabId = sourceIds.at(-1) ?? target.activeTabId;
    source.updatedAt = now();
    target.updatedAt = now();
    this.write();
    return true;
  }

  update(windowId: string, patch: Partial<Omit<DesktopWindowRecord, 'id' | 'primary'>>): boolean {
    const record = this.envelope.windows.find(window => window.id === windowId);
    if (!record) return false;
    if (patch.workspaceId) record.workspaceId = patch.workspaceId.slice(0, 128);
    if (patch.tabIds) record.tabIds = [...new Set(patch.tabIds)].slice(0, 100);
    if (patch.activeTabId !== undefined) record.activeTabId = patch.activeTabId && record.tabIds.includes(patch.activeTabId) ? patch.activeTabId : record.tabIds[0];
    if (patch.paneTree) record.paneTree = clonePane(patch.paneTree);
    if (patch.activePaneId !== undefined) record.activePaneId = patch.activePaneId;
    if (patch.chrome) record.chrome = JSON.parse(JSON.stringify(patch.chrome)) as WorkspaceChromeState;
    if (patch.geometry) record.geometry = { ...patch.geometry };
    record.updatedAt = now();
    this.write();
    return true;
  }

  remove(windowId: string, transferTabsToPrimary = true): boolean {
    const record = this.envelope.windows.find(window => window.id === windowId);
    if (!record || record.primary) return false;
    const primary = this.envelope.windows.find(window => window.id === this.envelope.primaryWindowId && window.workspaceId === record.workspaceId);
    if (transferTabsToPrimary && primary) {
      for (const tabId of record.tabIds) if (!primary.tabIds.includes(tabId)) primary.tabIds.push(tabId);
      primary.activeTabId ??= primary.tabIds[0];
    }
    this.envelope.windows = this.envelope.windows.filter(window => window.id !== windowId);
    this.write();
    return true;
  }

  private read(): DesktopWindowStorageEnvelope {
    try {
      const raw = this.storage.getItem(DESKTOP_WINDOW_REGISTRY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isRecord(parsed) && parsed.version === 2 && Array.isArray(parsed.windows) && validateDesktopWindowRegistry(parsed).ok) {
          const seen = new Set<string>();
          const windows = parsed.windows.flatMap(entry => {
            const record = sanitizeWindowRecord(entry);
            if (!record || seen.has(record.id)) return [];
            seen.add(record.id);
            return [record];
          });
          if (windows.length) {
            return { version: 2, primaryWindowId: PRIMARY_DESKTOP_WINDOW_ID, windows };
          }
        } else {
          this.quarantine(raw, isRecord(parsed) && parsed.version === 1 ? 'legacy-v1-registry' : validateDesktopWindowRegistry(parsed).reason ?? 'invalid-registry');
        }
      }
    } catch {
      this.quarantine(this.storage.getItem(DESKTOP_WINDOW_REGISTRY_KEY) ?? '', 'malformed-registry-json');
    }
    return { version: 2, primaryWindowId: PRIMARY_DESKTOP_WINDOW_ID, windows: [] };
  }

  private validateWorkspaceState(workspace: WorkspaceRecord): boolean {
    const raw = this.envelope;
    const validation = validateDesktopWindowRegistry(raw);
    if (!validation.ok && raw.windows.length > 0) return false;
    const relevant = raw.windows.filter(window => window.workspaceId === workspace.id);
    const primary = raw.windows.find(window => window.id === PRIMARY_DESKTOP_WINDOW_ID);
    if (primary && primary.workspaceId !== workspace.id) return false;
    const canonicalIds = new Set(workspace.tabs.map(tab => tab.id));
    const owned = new Set<string>();
    for (const window of relevant) {
      if (window.id !== PRIMARY_DESKTOP_WINDOW_ID && window.tabIds.length === 0) return false;
      for (const tabId of window.tabIds) {
        if (!canonicalIds.has(tabId) || owned.has(tabId)) return false;
        owned.add(tabId);
      }
    }
    return true;
  }

  private quarantine(raw: string, reason: string): void {
    const bounded = raw.slice(0, MAX_QUARANTINED_WINDOW_STATE);
    try {
      this.storage.setItem(DESKTOP_WINDOW_REGISTRY_QUARANTINE_KEY, JSON.stringify({ version: 1, reason, capturedAt: now(), raw: bounded }));
    } catch { /* diagnostics are best effort */ }
    if (raw) console.warn(`[Keystone] rejected persisted window registry: ${reason}`);
  }

  private write(): void {
    try { this.storage.setItem(DESKTOP_WINDOW_REGISTRY_KEY, JSON.stringify(this.envelope)); } catch { /* optional storage */ }
  }
}

function cloneRecord(record: WorkspaceRecord): WorkspaceRecord {
  return JSON.parse(JSON.stringify(record)) as WorkspaceRecord;
}

export interface RouteResult {
  kind: 'object' | 'web' | 'command' | 'query' | 'invalid' | 'locked';
  input: string;
  ref?: KeystoneObjectReference;
  url?: string;
  command?: string;
  query?: string;
  reason?: string;
}

export type RoutePermission = (ref: KeystoneObjectReference) => boolean;

export class KeystoneLinkRouter {
  constructor(private readonly canOpen: RoutePermission = () => true) {}

  resolve(input: string): RouteResult {
    const value = input.trim();
    if (!value) return { kind: 'invalid', input, reason: 'empty' };
    if (value.startsWith('keystone://')) return this.resolveKeystone(value);
    if (/^https?:\/\//i.test(value)) return { kind: 'web', input, url: value };
    if (value.startsWith('>')) return { kind: 'command', input, command: value.slice(1).trim() };
    if (/^(open|new|search|ask|split|close|reopen|settings)\b/i.test(value)) return { kind: 'command', input, command: value };
    if (/\s/.test(value) || /[?！？]$/.test(value)) return { kind: 'query', input, query: value };
    return { kind: 'query', input, query: value };
  }

  open(input: string): RouteResult {
    const result = this.resolve(input);
    if (result.kind === 'object' && result.ref && !this.canOpen(result.ref)) return { ...result, kind: 'locked', reason: 'permission-denied' };
    return result;
  }

  private resolveKeystone(input: string): RouteResult {
    let parsed: URL;
    try { parsed = new URL(input); } catch { return { kind: 'invalid', input, reason: 'malformed-link' }; }
    if (parsed.protocol !== 'keystone:' || parsed.username || parsed.password || parsed.port || parsed.hash) return { kind: 'invalid', input, reason: 'malformed-link' };
    const kind = parsed.hostname as DesktopObjectKind | 'place' | 'task' | 'conversation' | 'devices' | 'files' | 'documents';
    const path = parsed.pathname.split('/').filter(Boolean).map(segment => {
      try { return decodeURIComponent(segment); } catch { return ''; }
    });
    const routeRefs: Record<string, KeystoneObjectReference> = {
      home: { kind: 'home', id: 'home', label: 'Home' },
      search: { kind: 'settings', id: 'search', label: 'Search' },
      settings: { kind: 'settings', id: 'settings', label: 'Settings' },
      music: { kind: 'music', id: 'music', label: 'Music' },
      video: { kind: 'video', id: 'video', label: 'Video' },
      shorts: { kind: 'shorts', id: 'shorts', label: 'Shorts' },
      files: { kind: 'file', id: 'files', label: 'Files' },
      documents: { kind: 'document', id: 'documents', label: 'Documents' },
      tasks: { kind: 'tasks', id: 'tasks', label: 'Tasks' },
      capture: { kind: 'capture', id: 'capture', label: 'Quick Capture' },
      ai: { kind: 'ai', id: 'ai', label: 'Local AI' },
      devices: { kind: 'settings', id: 'device', label: 'Device' },
      network: { kind: 'network', id: 'network', label: 'Connectivity' },
    };
    if (!path.length && routeRefs[kind]) return { kind: 'object', input, ref: routeRefs[kind] };
    if ((kind === 'task' || kind === 'conversation') && path.length === 1) {
      const ref: KeystoneObjectReference = { kind: kind === 'task' ? 'tasks' : 'chat', id: path[0] };
      return path[0] && path[0].length <= 256 && !/[\u0000-\u001f]/.test(path[0]) ? { kind: 'object', input, ref } : { kind: 'invalid', input, reason: 'unknown-object' };
    }
    const visualKind: DesktopObjectKind = kind === 'place' ? 'map' : kind === 'task' ? 'tasks' : kind === 'conversation' ? 'chat' : kind === 'vault' && path[1] === 'graph' ? 'graph' : kind === 'vault' && path[1] === 'canvas' ? 'canvas' : kind as DesktopObjectKind;
    let queryId = '';
    try { queryId = decodeURIComponent(parsed.searchParams.get('id') || '').trim(); } catch { return { kind: 'invalid', input, reason: 'malformed-link' }; }
    const objectId = kind === 'place' ? path[0] : visualKind === 'graph' ? path[0] : visualKind === 'canvas' ? path[2] : (kind === 'calendar' && path[0] === 'event' ? path[1] : kind === 'vault' && path[1] === 'note' ? path[2] : path[0]) ?? queryId;
    if (!KNOWN_OBJECT_KINDS.has(visualKind) || !objectId || objectId.length > 256 || /[\u0000-\u001f]/.test(objectId)) return { kind: 'invalid', input, reason: 'unknown-object' };
    const revisionAddress = visualKind === 'publication' && path[1] === 'revision' && /^sha256-[a-f0-9]{64}$/i.test(path[2] ?? '') ? path[2] : undefined;
    if (visualKind === 'publication' && path[1] === 'revision' && !revisionAddress) return { kind: 'invalid', input, reason: 'unknown-object' };
    const ref: KeystoneObjectReference = { kind: visualKind, id: objectId, ...(revisionAddress ? { revisionAddress } : {}), ...(visualKind === 'graph' || visualKind === 'canvas' ? { vaultId: path[0] } : {}), ...(kind === 'vault' && path[1] === 'note' && path[0] ? { vaultId: path[0] } : {}), ...(kind === 'calendar' && path[0] === 'event' ? { label: 'Calendar event' } : {}), ...(kind === 'place' ? { label: 'Place' } : {}) };
    return { kind: 'object', input, ref };
  }
}

export interface OmniboxResolution {
  type: 'object' | 'web' | 'command' | 'agent-query' | 'search' | 'invalid';
  value: string;
  ref?: KeystoneObjectReference;
  url?: string;
  command?: string;
}

export function resolveOmniboxInput(input: string, router = new KeystoneLinkRouter()): OmniboxResolution {
  if (/^vault:\s*/i.test(input.trim())) return { type: 'search', value: input, command: input.trim().replace(/^vault:\s*/i, '') };
  if (/^#[-\w/]+$/.test(input.trim()) || /^\[\[[^\]]+\]\]$/.test(input.trim())) return { type: 'search', value: input, command: input.trim() };
  const result = router.resolve(input);
  if (result.kind === 'object' && result.ref) return { type: 'object', value: input, ref: result.ref };
  if (result.kind === 'web' && result.url) return { type: 'web', value: input, url: result.url };
  if (result.kind === 'command' && result.command) return { type: 'command', value: input, command: result.command };
  if (result.kind === 'query' && result.query) return { type: /\s/.test(result.query) || /[?！？]$/.test(result.query) ? 'agent-query' : 'search', value: input, command: result.query };
  return { type: 'invalid', value: input };
}

export interface ShellCommand {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  /** Commands kept for compatibility can be represented but are hidden from the palette. */
  available?: boolean;
  run: (shell: DesktopShellController) => void;
}

export function defaultShellCommands(locale: 'en' | 'ru' = 'en'): ShellCommand[] {
  const ru = locale === 'ru';
  const label = (en: string, russian: string) => ru ? russian : en;
  const unavailable = (id: string, en: string, russian: string): ShellCommand => ({
    id,
    label: label(en, russian),
    available: false,
    description: label('Unavailable until its host adapter is connected', 'Недоступно до подключения host adapter'),
    run: shell => shell.setNotice(label(`${en} is unavailable on this host.`, `${russian} недоступно на этом host.`)),
  });
  return [
    { id: 'open', label: label('Open Home', 'Открыть главную'), keywords: ['home', 'start', 'главная'], run: shell => shell.openReference({ kind: 'home', id: 'home', label: label('Home', 'Главная') }) },
    { id: 'open-search', label: label('Search local data', 'Искать локальные данные'), keywords: ['search', 'find', 'поиск'], run: shell => shell.openReference({ kind: 'settings', id: 'search', label: label('Search', 'Поиск') }) },
    { id: 'open-music', label: label('Open Music', 'Открыть музыку'), keywords: ['music', 'audio', 'tracks', 'музыка', 'аудио'], run: shell => shell.openReference({ kind: 'music', id: 'music', label: label('Music', 'Музыка') }) },
    { id: 'open-video', label: label('Open Video', 'Открыть видео'), keywords: ['video', 'videos', 'видео'], run: shell => shell.openReference({ kind: 'video', id: 'video', label: label('Video', 'Видео') }) },
    { id: 'open-shorts', label: label('Open Shorts', 'Открыть Shorts'), keywords: ['shorts', 'short video', 'короткие видео'], run: shell => shell.openReference({ kind: 'shorts', id: 'shorts', label: label('Shorts', 'Shorts') }) },
    { id: 'open-ai', label: label('Open Local AI', 'Открыть локальный AI'), keywords: ['ai', 'local ai', 'ollama', 'lm studio', 'локальный ai'], run: shell => shell.openReference({ kind: 'ai', id: 'ai', label: label('Local AI', 'Локальный AI') }) },
    { id: 'open-connectivity', label: label('Open Connectivity', 'Открыть связь'), keywords: ['connectivity', 'network', 'offline', 'p2p', 'связь', 'сеть'], run: shell => shell.openReference({ kind: 'network', id: 'network', label: label('Connectivity', 'Связь') }) },
    { id: 'open-capture', label: label('Open Quick Capture', 'Открыть быстрый захват'), keywords: ['capture', 'quick capture', 'захват'], run: shell => shell.requestQuickCapture() },
    { id: 'open-tasks', label: label('Open Tasks', 'Открыть задачи'), keywords: ['tasks', 'todo', 'planning', 'задачи'], run: shell => shell.openReference({ kind: 'tasks', id: 'tasks', label: label('Tasks', 'Задачи') }) },
    { id: 'new-task', label: label('New Task', 'Новая задача'), keywords: ['new task', 'todo', 'новая задача'], run: shell => shell.openReference({ kind: 'tasks', id: 'new-task', label: label('New Task', 'Новая задача') }, { allowDuplicate: true }) },
    { id: 'open-documents', label: label('Open Documents', 'Открыть документы'), keywords: ['documents', 'document', 'reader', 'pdf', 'epub', 'документы'], run: shell => shell.openReference({ kind: 'document', id: 'documents', label: label('Documents', 'Документы') }) },
    { id: 'new-document', label: label('New Markdown document', 'Новый Markdown-документ'), keywords: ['new document', 'markdown', 'документ'], run: shell => shell.openReference({ kind: 'document', id: 'new-document', label: label('New document', 'Новый документ') }, { allowDuplicate: true }) },
    { id: 'open-device', label: label('Open device and identity', 'Открыть устройство и профиль'), keywords: ['device', 'identity', 'устройство', 'identity'], run: shell => shell.openReference({ kind: 'settings', id: 'device', label: label('Device', 'Устройство') }) },
    { id: 'settings', label: label('Open Settings', 'Открыть настройки'), keywords: ['settings', 'preferences', 'настройки'], run: shell => shell.openReference({ kind: 'settings', id: 'settings', label: label('Settings', 'Настройки') }) },
    { id: 'toggle-sidebar', label: label('Toggle context sidebar', 'Показать/скрыть панель контекста'), run: shell => shell.toggleContextSidebar() },
    { id: 'split-pane', label: label('Split pane', 'Разделить панель'), keywords: ['split', 'разделить'], run: shell => shell.splitPane('vertical') },
    { id: 'close-tab', label: label('Close tab', 'Закрыть вкладку'), keywords: ['close', 'закрыть'], run: shell => shell.closeActiveTab() },
    { id: 'reopen-tab', label: label('Reopen closed tab', 'Открыть закрытую вкладку'), keywords: ['reopen', 'restore', 'открыть снова'], run: shell => shell.reopenClosedTab() },
    { id: 'switch-workspace', label: label('Switch workspace', 'Сменить рабочее пространство'), keywords: ['workspace', 'пространство'], run: shell => shell.toggleWorkspaceMenu() },
    unavailable('open-vault', 'Open Vault', 'Открыть Vault'),
    unavailable('open-vault-graph', 'Open Vault Graph', 'Открыть граф Vault'),
    unavailable('open-mail', 'Open External Email', 'Открыть внешнюю почту'),
    unavailable('compose-mail', 'Compose external mail', 'Написать внешнее письмо'),
  ];
}

/** Historical command catalog retained only for migration/test compatibility. */
function legacyShellCommands(locale: 'en' | 'ru' = 'en'): ShellCommand[] {
  const ru = locale === 'ru';
  const label = (en: string, russian: string) => ru ? russian : en;
  return [
    { id: 'open', label: label('Open…', 'Открыть…'), keywords: ['tab', 'object'], run: shell => shell.openReference({ kind: 'home', id: 'home', label: 'Home' }) },
    { id: 'open-capture', label: label('Open Quick Capture', 'Открыть быстрый захват'), keywords: ['capture', 'quick capture', 'share in', 'clipboard', 'захват', 'быстрый ввод'], run: shell => shell.requestQuickCapture() },
    { id: 'open-maps', label: label('Open Maps', 'Открыть Карты'), keywords: ['maps', 'map', 'open maps', 'карты', 'карта'], run: shell => shell.openReference({ kind: 'map', id: 'map', label: label('Maps', 'Карты') }) },
    { id: 'open-mail', label: label('Open External Email', 'Открыть внешнюю почту'), keywords: ['mail', 'email', 'inbox', 'почта', 'письма'], run: shell => shell.openReference({ kind: 'mail', id: 'mail', label: label('External Email', 'Внешняя почта') }) },
    { id: 'open-documents', label: label('Open Documents', 'Открыть документы'), keywords: ['documents', 'document', 'reader', 'pdf', 'epub', 'ocr', 'документы', 'ридер', 'сканирование'], run: shell => shell.openReference({ kind: 'document', id: 'documents', label: label('Documents', 'Документы') }) },
    { id: 'open-subscriptions', label: label('Open Subscriptions', 'Открыть подписки'), keywords: ['feeds', 'rss', 'atom', 'podcast', 'подписки', 'ленты', 'подкасты'], run: shell => shell.openReference({ kind: 'subscriptions', id: 'subscriptions', label: label('Subscriptions', 'Подписки') }) },
    { id: 'open-tasks', label: label('Open Tasks', 'Открыть задачи'), keywords: ['tasks', 'todo', 'planning', 'задачи', 'планирование'], run: shell => shell.openReference({ kind: 'tasks', id: 'tasks', label: label('Tasks', 'Задачи') }) },
    { id: 'open-contacts', label: label('Open Contacts', 'Открыть контакты'), keywords: ['contacts', 'address book', 'people', 'контакты', 'адресная книга', 'люди'], run: shell => shell.openReference({ kind: 'contacts', id: 'contacts', label: label('Contacts', 'Контакты') }) },
    { id: 'tasks-today', label: label('Open Tasks for today', 'Открыть задачи на сегодня'), keywords: ['today tasks', 'задачи сегодня'], run: shell => shell.openReference({ kind: 'tasks', id: 'today', label: label('Tasks · Today', 'Задачи · Сегодня') }) },
    { id: 'tasks-overdue', label: label('Open overdue Tasks', 'Открыть просроченные задачи'), keywords: ['overdue tasks', 'просроченные задачи'], run: shell => shell.openReference({ kind: 'tasks', id: 'overdue', label: label('Tasks · Overdue', 'Задачи · Просроченные') }) },
    { id: 'new-task', label: label('New Task', 'Новая задача'), keywords: ['new task', 'todo', 'новая задача'], run: shell => shell.openReference({ kind: 'tasks', id: 'new-task', label: label('New Task', 'Новая задача') }, { allowDuplicate: true }) },
    { id: 'open-continuity', label: label('Open Device Continuity', 'Открыть Continuity устройств'), keywords: ['continuity', 'handoff', 'send to device', 'device inbox', 'продолжить на устройстве', 'отправить на устройство'], run: shell => shell.openReference({ kind: 'settings', id: 'continuity', label: label('Device Continuity', 'Continuity устройств') }) },
    { id: 'open-nearby-exchange', label: label('Open Nearby Exchange', 'Открыть Nearby Exchange'), keywords: ['nearby', 'quick share', 'share nearby', 'обмен рядом', 'быстрая передача'], run: shell => shell.openReference({ kind: 'settings', id: 'nearby', label: label('Nearby Exchange', 'Обмен рядом') }) },
    { id: 'open-device-inbox', label: label('Open Device Inbox', 'Открыть входящие устройства'), keywords: ['device inbox', 'handoff inbox', 'входящие устройства'], run: shell => shell.openReference({ kind: 'settings', id: 'continuity', label: label('Device Inbox', 'Входящие устройства') }) },
    { id: 'send-to-device', label: label('Send current workspace to device', 'Отправить текущее пространство на устройство'), keywords: ['send to device', 'handoff workspace', 'отправить на устройство'], run: shell => shell.openReference({ kind: 'settings', id: 'continuity', label: label('Send to Device', 'Отправить на устройство') }) },
    { id: 'continue-on-device', label: label('Continue current workspace on device', 'Продолжить текущее пространство на устройстве'), keywords: ['continue on device', 'continue workspace', 'продолжить на устройстве'], run: shell => shell.openReference({ kind: 'settings', id: 'continuity', label: label('Continue on Device', 'Продолжить на устройстве') }) },
    { id: 'compose-mail', label: label('Compose external mail', 'Написать внешнее письмо'), keywords: ['compose mail', 'new email', 'написать письмо'], run: shell => shell.openReference({ kind: 'mail', id: 'compose', label: label('Compose external mail', 'Новое внешнее письмо') }, { allowDuplicate: true }) },
    { id: 'refresh-mail', label: label('Refresh external mail', 'Обновить внешнюю почту'), keywords: ['refresh mail', 'sync mail', 'синхронизировать почту'], run: shell => { shell.openReference({ kind: 'mail', id: 'mail', label: label('External Email', 'Внешняя почта') }); shell.setNotice(label('Mail refresh is provided by the host adapter.', 'Обновление почты выполняется через host adapter.')); } },
    { id: 'show-my-location', label: label('Show my location', 'Показать мою геопозицию'), keywords: ['my location', 'location', 'геопозиция'], run: shell => { shell.openReference({ kind: 'map', id: 'map', label: label('Maps', 'Карты') }); shell.setNotice(label('Location is available only after the explicit Maps action.', 'Геопозиция доступна только после явного действия в Картах.')); } },
    { id: 'audio-call', label: label('Audio call…', 'Аудиозвонок…'), keywords: ['call', 'voice', 'звонок', 'аудио'], run: shell => shell.openReference({ kind: 'media', id: 'calls', label: label('Calls', 'Звонки') }) },
    { id: 'video-call', label: label('Video call…', 'Видеозвонок…'), keywords: ['video call', 'video', 'видеозвонок'], run: shell => shell.openReference({ kind: 'media', id: 'calls', label: label('Calls', 'Звонки') }) },
    { id: 'mute-call', label: label('Mute microphone', 'Выключить микрофон'), keywords: ['mute', 'microphone', 'микрофон'], run: shell => shell.setNotice(label('Mute is controlled by the active CallService session.', 'Микрофон управляется активной сессией CallService.')) },
    { id: 'camera-call', label: label('Enable camera', 'Включить камеру'), keywords: ['camera', 'камера'], run: shell => shell.setNotice(label('Camera access requires an explicit host permission.', 'Доступ к камере требует явного разрешения host.')) },
    { id: 'end-call', label: label('End call', 'Завершить звонок'), keywords: ['hangup', 'завершить звонок'], run: shell => shell.setNotice(label('Hangup is controlled by the active CallService session.', 'Завершение управляется активной сессией CallService.')) },
    { id: 'new-message', label: label('New message', 'Новое сообщение'), run: shell => shell.openReference({ kind: 'chat', id: 'new', label: label('New message', 'Новое сообщение') }, { allowDuplicate: true }) },
    { id: 'new-space', label: label('New Space', 'Новое пространство'), run: shell => shell.openReference({ kind: 'space', id: 'new', label: label('New Space', 'Новое пространство') }, { allowDuplicate: true }) },
    { id: 'new-note', label: label('New note', 'Новая заметка'), keywords: ['markdown', 'note', 'заметка'], run: shell => shell.openReference({ kind: 'vault', id: 'new-note', label: label('New note', 'Новая заметка') }, { allowDuplicate: true }) },
    { id: 'new-publication', label: label('New publication', 'Новая публикация'), keywords: ['publish', 'page', 'article', 'публикация', 'страница', 'статья'], run: shell => shell.openReference({ kind: 'publication', id: 'new', label: label('New publication', 'Новая публикация') }, { allowDuplicate: true }) },
    { id: 'open-vault', label: label('Open Vault', 'Открыть Vault'), keywords: ['vault', 'notes', 'markdown', 'хранилище', 'заметки'], run: shell => shell.openReference({ kind: 'vault', id: 'vault', label: label('Vault', 'Хранилище') }) },
    { id: 'search-vault', label: label('Search Vault', 'Искать в Vault'), keywords: ['vault search', 'markdown search', 'поиск заметок'], run: shell => shell.openReference({ kind: 'vault', id: 'vault-search', label: label('Vault search', 'Поиск Vault') }) },
    { id: 'open-note', label: label('Open note…', 'Открыть заметку…'), keywords: ['note', 'open note', 'заметка'], run: shell => shell.openReference({ kind: 'vault', id: 'note-picker', label: label('Open note', 'Открыть заметку') }, { allowDuplicate: true }) },
    { id: 'daily-note-today', label: label('Open today’s Daily Note', 'Открыть ежедневную заметку'), keywords: ['daily note', 'journal', 'сегодня', 'дневник'], run: shell => shell.openReference({ kind: 'vault', id: 'daily-today', label: label('Daily Note', 'Ежедневная заметка') }, { allowDuplicate: true }) },
    { id: 'template-picker', label: label('Insert Vault template…', 'Вставить шаблон Vault…'), keywords: ['template', 'шаблон'], run: shell => shell.openReference({ kind: 'vault', id: 'templates', label: label('Vault templates', 'Шаблоны Vault') }, { allowDuplicate: true }) },
    { id: 'create-template', label: label('Create Vault template', 'Создать шаблон Vault'), keywords: ['template', 'create template', 'шаблон'], run: shell => shell.openReference({ kind: 'vault', id: 'template-new', label: label('New Vault template', 'Новый шаблон Vault') }, { allowDuplicate: true }) },
    { id: 'vault-bookmarks', label: label('Open Vault bookmarks', 'Открыть закладки Vault'), keywords: ['bookmark', 'bookmarks', 'закладки'], run: shell => shell.openReference({ kind: 'vault', id: 'bookmarks', label: label('Vault bookmarks', 'Закладки Vault') }) },
    { id: 'vault-quick-switcher', label: label('Vault quick switcher', 'Быстрый переключатель Vault'), keywords: ['quick switcher', 'fuzzy', 'переключатель'], run: shell => shell.openReference({ kind: 'vault', id: 'quick-switcher', label: label('Quick Switcher', 'Быстрый переключатель') }, { allowDuplicate: true }) },
    { id: 'vault-query', label: label('Run Vault query…', 'Выполнить запрос Vault…'), keywords: ['query', 'table', 'list', 'запрос', 'таблица'], run: shell => shell.openReference({ kind: 'vault', id: 'query', label: label('Vault query', 'Запрос Vault') }, { allowDuplicate: true }) },
    { id: 'vault-views', label: label('Open saved Vault views', 'Открыть представления Vault'), keywords: ['view', 'board', 'table', 'представление', 'доска'], run: shell => shell.openReference({ kind: 'vault', id: 'views', label: label('Vault views', 'Представления Vault') }) },
    { id: 'create-view', label: label('Create Vault view', 'Создать представление Vault'), keywords: ['view', 'create view', 'представление'], run: shell => shell.openReference({ kind: 'vault', id: 'view-new', label: label('New Vault view', 'Новое представление Vault') }, { allowDuplicate: true }) },
    { id: 'open-view', label: label('Open Vault view…', 'Открыть представление Vault…'), keywords: ['view', 'open view', 'представление'], run: shell => shell.openReference({ kind: 'vault', id: 'view-picker', label: label('Open Vault view', 'Открыть представление Vault') }, { allowDuplicate: true }) },
    { id: 'create-board', label: label('Create Vault board', 'Создать доску Vault'), keywords: ['board', 'kanban', 'доска'], run: shell => shell.openReference({ kind: 'vault', id: 'board-new', label: label('New Vault board', 'Новая доска Vault') }, { allowDuplicate: true }) },
    { id: 'create-table', label: label('Create Vault table', 'Создать таблицу Vault'), keywords: ['table', 'create table', 'таблица'], run: shell => shell.openReference({ kind: 'vault', id: 'table-new', label: label('New Vault table', 'Новая таблица Vault') }, { allowDuplicate: true }) },
    { id: 'shared-vaults', label: label('Open Shared Vaults', 'Открыть общие Vault'), keywords: ['shared vault', 'collaboration', 'общий vault', 'совместная работа'], run: shell => shell.openReference({ kind: 'vault', id: 'shared', label: label('Shared Vaults', 'Общие Vault') }) },
    { id: 'create-shared-vault', label: label('Create Shared Vault', 'Создать общий Vault'), keywords: ['shared vault', 'create', 'общий vault'], run: shell => shell.openReference({ kind: 'vault', id: 'shared-new', label: label('New Shared Vault', 'Новый общий Vault') }, { allowDuplicate: true }) },
    { id: 'invite-to-vault', label: label('Invite to Vault…', 'Пригласить в Vault…'), keywords: ['vault invite', 'invite', 'пригласить'], run: shell => shell.openReference({ kind: 'vault', id: 'shared-invite', label: label('Invite to Vault', 'Приглашение в Vault') }, { allowDuplicate: true }) },
    { id: 'shared-vault-members', label: label('Open Shared Vault members', 'Открыть участников общего Vault'), keywords: ['vault members', 'shared members', 'участники'], run: shell => shell.openReference({ kind: 'vault', id: 'shared-members', label: label('Shared Vault members', 'Участники общего Vault') }, { allowDuplicate: true }) },
    { id: 'rename-note', label: label('Rename note', 'Переименовать заметку'), keywords: ['rename note', 'заметка', 'переименовать'], run: shell => shell.setNotice(label('Rename is performed by the Vault host adapter.', 'Переименование выполняется через Vault host adapter.')) },
    { id: 'move-note', label: label('Move note', 'Переместить заметку'), keywords: ['move note', 'folder', 'переместить'], run: shell => shell.setNotice(label('Move is performed by the Vault host adapter.', 'Перемещение выполняется через Vault host adapter.')) },
    { id: 'new-vault-folder', label: label('New Vault folder', 'Новая папка Vault'), keywords: ['folder', 'vault folder', 'папка'], run: shell => shell.setNotice(label('Folder creation is performed by the Vault host adapter.', 'Создание папки выполняется через Vault host adapter.')) },
    { id: 'open-vault-properties', label: label('Open note properties', 'Открыть свойства заметки'), keywords: ['properties', 'frontmatter', 'свойства'], run: shell => shell.setNotice(label('Properties are shown in the Vault inspector.', 'Свойства показаны в инспекторе Vault.')) },
    { id: 'convert-task-to-work-item', label: label('Convert task to WorkItem', 'Преобразовать задачу в WorkItem'), keywords: ['task', 'work item', 'задача'], run: shell => shell.setNotice(label('Task conversion requires an explicit WorkItem adapter confirmation.', 'Преобразование задачи требует явного подтверждения WorkItem adapter.')) },
    { id: 'rebuild-vault-index', label: label('Rebuild Vault index', 'Перестроить индекс Vault'), keywords: ['vault index', 'rebuild index', 'индекс'], run: shell => shell.setNotice(label('Vault index rebuild is requested through the host adapter.', 'Перестроение индекса Vault выполняется через host adapter.')) },
    { id: 'open-vault-backlinks', label: label('Open Vault backlinks', 'Открыть backlinks Vault'), keywords: ['backlinks', 'links', 'обратные ссылки'], run: shell => shell.setNotice(label('Backlinks are resolved by VaultLinkIndex.', 'Backlinks вычисляются VaultLinkIndex.')) },
    { id: 'open-vault-graph', label: label('Open Vault Graph', 'Открыть граф Vault'), keywords: ['graph', 'vault graph', 'граф'], run: shell => shell.openReference({ kind: 'graph', id: 'vault', vaultId: 'vault', label: label('Vault Graph', 'Граф Vault') }) },
    { id: 'open-local-graph', label: label('Open Local Graph', 'Открыть локальный граф'), keywords: ['local graph', 'neighbors', 'локальный граф'], run: shell => shell.openReference({ kind: 'graph', id: 'local', vaultId: 'vault', label: label('Local Graph', 'Локальный граф') }) },
    { id: 'create-canvas', label: label('Create Canvas', 'Создать Canvas'), keywords: ['canvas', 'board', 'холст'], run: shell => shell.openReference({ kind: 'canvas', id: 'new-canvas', vaultId: 'vault', label: label('New Canvas', 'Новый Canvas') }, { allowDuplicate: true }) },
    { id: 'open-canvas', label: label('Open Canvas', 'Открыть Canvas'), keywords: ['canvas', 'open canvas', 'холст'], run: shell => shell.openReference({ kind: 'canvas', id: 'canvas', vaultId: 'vault', label: label('Canvas', 'Canvas') }) },
    { id: 'show-orphans', label: label('Show Orphan Notes', 'Показать заметки без связей'), keywords: ['orphans', 'orphan notes', 'без связей'], run: shell => shell.setNotice(label('Orphan notes are computed by the VaultGraphService.', 'Заметки без связей вычисляются VaultGraphService.')) },
    { id: 'show-unresolved', label: label('Show Unresolved Links', 'Показать неразрешённые ссылки'), keywords: ['unresolved', 'broken links', 'неразрешённые ссылки'], run: shell => shell.setNotice(label('Unresolved links are computed by VaultLinkIndex and VaultGraphService.', 'Неразрешённые ссылки вычисляются VaultLinkIndex и VaultGraphService.')) },
    { id: 'new-calendar-event', label: label('New calendar event', 'Новое событие календаря'), keywords: ['calendar', 'event', 'new event', 'событие', 'календарь'], run: shell => shell.openReference({ kind: 'calendar', id: 'new-event', label: label('New event', 'Новое событие') }, { allowDuplicate: true }) },
    { id: 'open-calendar', label: label('Open Calendar', 'Открыть календарь'), keywords: ['calendar', 'agenda', 'day', 'week', 'month'], run: shell => shell.openReference({ kind: 'calendar', id: 'calendar', label: label('Calendar', 'Календарь') }) },
    { id: 'calendar-today', label: label('Calendar: today', 'Календарь: сегодня'), keywords: ['today', 'сегодня'], run: shell => shell.openReference({ kind: 'calendar', id: 'calendar-today', label: label('Today', 'Сегодня') }) },
    { id: 'calendar-free-time', label: label('Find common free time', 'Найти общее свободное время'), keywords: ['free time', 'availability', 'свободное время'], run: shell => shell.setNotice(label('Availability is resolved by CalendarService with FREE_BUSY disclosure.', 'Свободное время вычисляется CalendarService с раскрытием FREE_BUSY.')) },
    { id: 'new-shared-calendar', label: label('Create shared calendar', 'Создать общий календарь'), keywords: ['shared calendar', 'общий календарь'], run: shell => shell.openReference({ kind: 'calendar', id: 'new-shared-calendar', label: label('New shared calendar', 'Новый общий календарь') }, { allowDuplicate: true }) },
    { id: 'calendar-invitations', label: label('Pending calendar invitations', 'Ожидающие приглашения календаря'), keywords: ['calendar invites', 'invitations', 'приглашения'], run: shell => shell.setNotice(label('Calendar invitations stay signed and permission-checked.', 'Приглашения календаря подписаны и проверяются по разрешениям.')) },
    { id: 'ask-agent', label: label('Ask Agent Bot', 'Спросить Agent Bot'), run: shell => shell.toggleAgentPanel(true) },
    { id: 'open-skills', label: label('Open Skills', 'Открыть Skills'), keywords: ['skills', 'procedures', 'навыки', 'процедуры'], run: shell => shell.openReference({ kind: 'settings', id: 'skills', label: label('Skills', 'Skills') }) },
    { id: 'install-skill', label: label('Install Skill…', 'Установить Skill…'), keywords: ['install skill', 'package', 'установить skill', 'пакет'], run: shell => shell.openReference({ kind: 'settings', id: 'skills-install', label: label('Install Skill', 'Установить Skill') }, { allowDuplicate: true }) },
    { id: 'create-skill', label: label('Create Skill', 'Создать Skill'), keywords: ['create skill', 'procedure', 'создать skill'], run: shell => shell.openReference({ kind: 'settings', id: 'skills-create', label: label('Create Skill', 'Создать Skill') }, { allowDuplicate: true }) },
    { id: 'review-skill-candidates', label: label('Review Skill Candidates', 'Проверить кандидатов Skills'), keywords: ['skill candidates', 'learning', 'кандидаты skill', 'обучение'], run: shell => shell.openReference({ kind: 'settings', id: 'skills-candidates', label: label('Skill Candidates', 'Кандидаты Skills') }, { allowDuplicate: true }) },
    { id: 'export-skill', label: label('Export Skill…', 'Экспортировать Skill…'), keywords: ['export skill', 'share skill', 'экспорт skill'], run: shell => shell.setNotice(label('Export uses an explicit SkillPackage/FileObject adapter.', 'Экспорт выполняется через явный SkillPackage/FileObject adapter.')) },
    { id: 'settings', label: label('Open Settings', 'Открыть настройки'), run: shell => shell.openReference({ kind: 'settings', id: 'settings', label: label('Settings', 'Настройки') }) },
    { id: 'toggle-sidebar', label: label('Toggle sidebar', 'Показать/скрыть боковую панель'), run: shell => shell.toggleContextSidebar() },
    { id: 'split-pane', label: label('Split pane', 'Разделить панель'), run: shell => shell.splitPane('vertical') },
    { id: 'close-tab', label: label('Close tab', 'Закрыть вкладку'), run: shell => shell.closeActiveTab() },
    { id: 'reopen-tab', label: label('Reopen closed tab', 'Открыть закрытую вкладку'), run: shell => shell.reopenClosedTab() },
    { id: 'switch-workspace', label: label('Switch workspace', 'Сменить рабочее пространство'), run: shell => shell.toggleWorkspaceMenu() },
    { id: 'ai-resource-mode', label: label('AI resource mode', 'Режим ресурсов ИИ'), run: shell => shell.setNotice(label('AI resource mode is controlled in Settings.', 'Режим ресурсов ИИ настраивается в параметрах.')) },
  ];
}

export interface ContextPanelData {
  title: string;
  sections: Array<{ id: string; title: string; items: string[] }>;
}

export interface ContextProvider {
  id: string;
  supports: (ref: KeystoneObjectReference | undefined) => boolean;
  getContext: (ref: KeystoneObjectReference | undefined) => ContextPanelData;
}

export class ContextProviderRegistry {
  private providers: ContextProvider[] = [];
  register(provider: ContextProvider): () => void { this.providers.push(provider); return () => { this.providers = this.providers.filter(candidate => candidate !== provider); }; }
  resolve(ref: KeystoneObjectReference | undefined, browser?: DesktopBrowserPageState): ContextPanelData {
    if (browser) {
      return {
        title: browser.title || 'Browser page',
        sections: [
          { id: 'browser-page', title: 'Browser page', items: [`Origin: ${browser.origin}`, `Revision: ${browser.pageRevision}`, `Data class: ${browser.dataClass}`] },
          { id: 'browser-scope', title: 'Bounded scope', items: ['Page text is untrusted', 'Credentials and cookies are never exposed', `${browser.interactiveCount ?? 0} semantic controls available`] },
        ],
      };
    }
    const provider = this.providers.find(candidate => candidate.supports(ref));
    return provider?.getContext(ref) ?? { title: 'Context', sections: [] };
  }
}

export function createDefaultContextRegistry(locale: 'en' | 'ru' = 'en'): ContextProviderRegistry {
  const registry = new ContextProviderRegistry();
  const ru = locale === 'ru';
  registry.register({
    id: 'typed-object-context',
    supports: ref => Boolean(ref),
    getContext: ref => {
      const title = objectTitle(ref ?? { kind: 'unknown', id: '' });
      const objectId = ref?.id ?? '—';
      return { title, sections: [
        { id: 'properties', title: ru ? 'Свойства' : 'Properties', items: [`${ru ? 'Тип' : 'Type'}: ${ref?.kind ?? 'unknown'}`, `${ru ? 'ID объекта' : 'Object ID'}: ${objectId}`] },
        { id: 'links', title: ru ? 'Связи' : 'Links', items: [ru ? 'Связи появятся после подключения соответствующего сервиса.' : 'Links appear when the corresponding service is connected.'] },
        { id: 'related', title: ru ? 'Связанные объекты' : 'Related objects', items: [ru ? 'Нет загруженных связанных объектов.' : 'No related objects are loaded.'] },
      ] };
    },
  });
  registry.register({ id: 'empty-context', supports: () => true, getContext: () => ({ title: ru ? 'Контекст' : 'Context', sections: [] }) });
  return registry;
}

export class DesktopShellController {
  readonly workspaceManager: WorkspaceManager;
  readonly windowRegistry: DesktopWindowRegistry;
  readonly windowId: string;
  readonly isPrimaryWindow: boolean;
  readonly router: KeystoneLinkRouter;
  private readonly storage: DesktopStorage;
  private startupPreference: DesktopStartupPreference;
  tabs: TabManager;
  panes: PaneManager;
  navigation: DesktopNavigation;
  private chrome: WorkspaceChromeState;
  private listeners = new Set<() => void>();
  private notice = '';
  private browserStates = new Map<string, DesktopBrowserRuntimeState>();
  private toolFlow?: DesktopToolFlowState;
  private toolFlowControls?: { pause?: () => void; resume?: () => void; cancel?: () => void };
  private windowBridge?: DesktopWindowBridge;
  private ownedTabIds = new Set<string>();

  constructor(options: { storage?: DesktopStorage; canOpen?: RoutePermission; windowId?: string; detachedTabId?: string; windowBridge?: DesktopWindowBridge; startupMode?: 'restore' | 'clean' } = {}) {
    this.storage = options.storage ?? defaultStorage();
    this.startupPreference = readDesktopStartup(this.storage);
    this.workspaceManager = new WorkspaceManager(this.storage);
    this.windowRegistry = new DesktopWindowRegistry(this.storage);
    this.router = new KeystoneLinkRouter(options.canOpen ?? (() => true));
    const record = this.workspaceManager.current();
    this.windowBridge = options.windowBridge;
    this.windowRegistry.ensureWorkspace(record);
    const requestedWindowId = options.windowId ?? this.windowRegistry.primaryWindowId;
    const windowRecord = this.windowRegistry.prepareWindow(requestedWindowId, record, options.detachedTabId);
    // Keep the URL-selected native window identity even when its registry
    // record is not visible yet.  A secondary WebView can start a few ticks
    // before the source WebView's localStorage write is observable; falling
    // back to the primary here would render a duplicate primary shell.  The
    // host retries refreshFromStorage and either adopts the record or closes
    // the now-unowned secondary window.
    this.windowId = requestedWindowId;
    this.isPrimaryWindow = requestedWindowId === PRIMARY_DESKTOP_WINDOW_ID || windowRecord?.primary === true;
    const cleanStartup = options.startupMode === 'clean' && this.isPrimaryWindow;
    const cleanHome = record.tabs.find(tab => tab.object?.kind === 'home' && tab.object.id === 'home')
      ?? tabForReference({ kind: 'home', id: 'home', label: 'Home' }, { pinned: true });
    const visibleIds = cleanStartup ? new Set([cleanHome.id]) : new Set(windowRecord?.tabIds ?? (this.isPrimaryWindow ? record.tabs.map(tab => tab.id) : []));
    this.ownedTabIds = new Set(visibleIds);
    const initialTabs = cleanStartup ? [cleanHome] : windowRecord?.tabIds.flatMap(tabId => record.tabs.filter(tab => tab.id === tabId)) ?? [];
    this.tabs = new TabManager(initialTabs, record.closedTabs);
    const initialPaneTree = cleanStartup
      ? paneTreeForTabs(initialTabs)
      : this.isPrimaryWindow
      ? filterPaneTabs(record.paneTree, new Set(initialTabs.map(tab => tab.id)))
      : windowRecord?.paneTree
        ? filterPaneTabs(windowRecord.paneTree, new Set(initialTabs.map(tab => tab.id)))
        : paneTreeForTabs(initialTabs);
    this.panes = new PaneManager(initialPaneTree);
    this.navigation = new DesktopNavigation();
    this.chrome = JSON.parse(JSON.stringify(cleanStartup ? defaultWorkspaceChrome() : windowRecord?.chrome ?? record.chrome)) as WorkspaceChromeState;
    this.ensureActivePaneHasTab();
    for (const tab of initialTabs) if (tab.kind === 'browser') this.browserStates.set(tab.id, { sessionId: tab.browserSessionId, activity: tab.browserActivity ?? 'IDLE', page: tab.browserPageRevision !== undefined && tab.url ? { tabId: tab.id, url: tab.url, origin: safeBrowserOrigin(tab.url), title: tab.title, pageRevision: tab.browserPageRevision, dataClass: tab.browserDataClass ?? 'PUBLIC' } : undefined });
    this.revalidateTabs();
    if (this.isPrimaryWindow && initialTabs.length === 0 && this.tabs.list().length > 0) this.persistRecord(this.capture());
    const startupTarget = this.startupPreference.surface === 'workspace' ? this.startupPreference.target : undefined;
    if (startupTarget && this.tabs.findByReference(startupTarget)?.locked) this.openReference({ kind: 'home', id: 'home', label: 'Home' });
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getSnapshot(): DesktopShellSnapshot { return { workspace: this.capture(), navigation: this.navigation.list(), ...(this.toolFlow ? { toolFlow: this.toolFlowState() } : {}) }; }
  flush(): void { this.persistRecord(this.capture()); }
  get currentPaneId(): string { return this.capture().activePaneId; }
  get currentTab(): DesktopTab | undefined { const pane = this.panes.leaf(this.currentPaneId); return pane?.activeTabId ? this.tabs.get(pane.activeTabId) : undefined; }
  get currentNotice(): string { return this.notice; }
  /** Tabs owned by this native window, excluding tabs held by sibling windows. */
  currentTabs(): DesktopTab[] { return this.tabs.list(); }
  requestQuickCapture(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(DESKTOP_QUICK_CAPTURE_EVENT));
    else this.setNotice('Quick Capture is available in the desktop shell.');
  }
  setWindowBridge(bridge: DesktopWindowBridge | undefined): void { this.windowBridge = bridge; }
  listWindows(): DesktopWindowRecord[] { return this.windowRegistry.list(this.workspaceManager.current().id); }
  windowRecord(): DesktopWindowRecord | undefined { return this.windowRegistry.get(this.windowId); }
  setWindowGeometry(geometry: DesktopWindowGeometry): void { this.windowRegistry.update(this.windowId, { geometry }); }
  /** Collapse a restored multi-window session without changing its tabs. */
  consolidateWindows(): boolean {
    const workspace = this.workspaceManager.current();
    for (const window of this.windowRegistry.list(workspace.id)) {
      if (!window.primary) void Promise.resolve(this.windowBridge?.close?.(window.id));
    }
    const primary = this.windowRegistry.consolidateWorkspaceWindows(workspace);
    if (this.isPrimaryWindow) {
      this.loadWindowRecord(workspace, primary);
    } else {
      this.tabs = new TabManager([], workspace.closedTabs);
      this.panes = new PaneManager(paneTreeForTabs([]));
      this.closeEmptySecondaryWindow();
    }
    this.emit();
    return true;
  }

  /**
   * Reset only presentation state. With preserveTabs=false, active tabs move
   * to the bounded reopen queue; their underlying Keystone objects remain in
   * the canonical services and are not deleted.
   */
  resetWindowAndTabLayout(options: { preserveTabs?: boolean } = {}): boolean {
    const workspace = this.workspaceManager.current();
    const preserveTabs = options.preserveTabs !== false;
    for (const window of this.windowRegistry.list(workspace.id)) {
      if (!window.primary) void Promise.resolve(this.windowBridge?.close?.(window.id));
    }
    const home = workspace.tabs.find(tab => tab.object?.kind === 'home' && tab.object.id === 'home')
      ?? tabForReference({ kind: 'home', id: 'home', label: 'Home' }, { pinned: true });
    const tabs = preserveTabs ? workspace.tabs : [home];
    const movedToClosed = preserveTabs ? [] : workspace.tabs.filter(tab => tab.id !== home.id);
    const normalized = normalizeSessionTabs(tabs, [...movedToClosed, ...workspace.closedTabs]);
    const paneTree = paneTreeForTabs(normalized.tabs);
    const resetRecord: WorkspaceRecord = {
      ...workspace,
      tabs: normalized.tabs,
      closedTabs: normalized.closedTabs,
      paneTree,
      activePaneId: paneTree.id,
      chrome: defaultWorkspaceChrome(),
      updatedAt: now(),
    };
    this.workspaceManager.save(resetRecord);
    const primary = this.windowRegistry.resetWorkspaceLayout(resetRecord);
    this.navigation = new DesktopNavigation();
    if (this.isPrimaryWindow) {
      this.loadWindowRecord(resetRecord, primary);
    } else {
      this.tabs = new TabManager([], resetRecord.closedTabs);
      this.panes = new PaneManager(paneTreeForTabs([]));
      this.closeEmptySecondaryWindow();
    }
    this.emit();
    return true;
  }
  refreshFromStorage(): void {
    const workspace = this.workspaceManager.reload();
    this.windowRegistry.reload();
    this.windowRegistry.ensureWorkspace(workspace);
    const record = this.windowRegistry.prepareWindow(this.windowId, workspace);
    if (!record && !this.isPrimaryWindow) {
      this.tabs = new TabManager([], this.tabs.closedTabs);
      this.panes = new PaneManager(paneTreeForTabs([]));
      this.closeEmptySecondaryWindow();
      this.emit();
      return;
    }
    if (record) this.loadWindowRecord(workspace, record);
    if (!this.isPrimaryWindow && this.tabs.list().length === 0) {
      this.closeEmptySecondaryWindow();
      this.emit();
      return;
    }
    this.emit();
  }
  handleNativeWindowClose(): void {
    if (!this.isPrimaryWindow) {
      this.windowRegistry.remove(this.windowId, true);
      this.emit();
    }
  }
  startupSurface(): DesktopStartupPreference { return { ...this.startupPreference, target: this.startupPreference.target ? { ...this.startupPreference.target } : undefined }; }
  setStartupSurface(surface: DesktopStartupSurface, target?: KeystoneObjectReference): void {
    this.startupPreference = parseDesktopStartup({ version: 1, surface, ...(target ? { target } : {}) });
    try { this.storage.setItem(STARTUP_SURFACE_KEY, JSON.stringify(this.startupPreference)); } catch { /* storage is optional */ }
    this.restoreStartupSurface();
  }
  setNotice(value: string): void { this.notice = value; this.emit(); }
  clearNotice(): void { this.notice = ''; this.emit(); }
  toolFlowState(): DesktopToolFlowState | undefined { return this.toolFlow ? { ...this.toolFlow, steps: this.toolFlow.steps.map(step => ({ ...step })) } : undefined; }
  setToolFlowState(state: DesktopToolFlowState | undefined, controls?: { pause?: () => void; resume?: () => void; cancel?: () => void }): void {
    this.toolFlow = state ? { ...state, flowId: state.flowId.slice(0, 256), executionId: state.executionId.slice(0, 256), steps: state.steps.slice(0, 64).map(step => ({ ...step, id: step.id.slice(0, 256), label: step.label.slice(0, 120) })) } : undefined;
    this.toolFlowControls = controls;
    this.emit();
  }
  pauseToolFlow(): void { this.toolFlowControls?.pause?.(); if (this.toolFlow) { this.toolFlow = { ...this.toolFlow, status: 'paused', updatedAt: now(), steps: this.toolFlow.steps.map(step => step.status === 'running' ? { ...step, status: 'paused' } : step) }; this.emit(); } }
  resumeToolFlow(): void { this.toolFlowControls?.resume?.(); if (this.toolFlow) { this.toolFlow = { ...this.toolFlow, status: 'running', updatedAt: now(), steps: this.toolFlow.steps.map(step => step.status === 'paused' ? { ...step, status: 'running' } : step) }; this.emit(); } }
  cancelToolFlow(): void { this.toolFlowControls?.cancel?.(); if (this.toolFlow) { this.toolFlow = { ...this.toolFlow, status: 'cancelled', updatedAt: now(), steps: this.toolFlow.steps.map(step => step.status === 'running' || step.status === 'pending' ? { ...step, status: 'cancelled' } : step) }; this.emit(); } }

  openReference(ref: KeystoneObjectReference, options: { allowDuplicate?: boolean; paneId?: string; pinned?: boolean } = {}): DesktopTab | undefined {
    const route = this.router.open(referenceUrl(ref));
    if (route.kind === 'locked') { this.setNotice('This object is no longer available with the current permissions.'); return undefined; }
    if (route.kind !== 'object') return undefined;
    const allowDuplicate = options.allowDuplicate ?? false;
    const workspace = this.workspaceManager.current();
    // Reconcile the ownership map before routing. This repairs a valid
    // canonical tab that survived while its old window record did not, and
    // prevents the local TabManager from creating a second object tab.
    this.windowRegistry.ensureWorkspace(workspace);
    if (!allowDuplicate) {
      const owner = this.windowRegistry.ownerOfReference(workspace.id, workspace, ref);
      if (owner && owner.id !== this.windowId) {
        void Promise.resolve(this.windowBridge?.focus(owner.id));
        return workspace.tabs.find(candidate => candidate.object?.kind === ref.kind && candidate.object.id === ref.id);
      }
    }
    const canonical = workspace.tabs.find(candidate => candidate.object?.kind === ref.kind && candidate.object.id === ref.id);
    const tab = this.tabs.open(canonical ?? tabForReference(ref, { pinned: options.pinned }), allowDuplicate);
    const paneId = options.paneId ?? this.currentPaneId;
    if (!this.panes.leaf(paneId)) this.panes.addTab(this.panes.firstPaneId(), tab.id);
    else if (this.panes.findTabOwner(tab.id) && this.panes.findTabOwner(tab.id) !== paneId && !allowDuplicate) this.panes.moveTab(tab.id, paneId);
    else this.panes.addTab(paneId, tab.id, true);
    this.navigation.push({ tabId: tab.id, ref: tab.object, title: tab.title });
    this.persistAndEmit();
    return tab;
  }

  openBrowser(url: string, options: { sessionId?: string; title?: string } = {}): DesktopTab | undefined {
    const route = this.router.open(url);
    if (route.kind !== 'web' || !route.url) return undefined;
    const tab = this.tabs.open(browserTab(route.url, options.title ?? 'Browser', options.sessionId), true);
    this.panes.addTab(this.currentPaneId, tab.id, true);
    this.browserStates.set(tab.id, { sessionId: options.sessionId, activity: 'IDLE' });
    this.navigation.push({ tabId: tab.id, url: route.url, title: tab.title });
    this.persistAndEmit();
    return tab;
  }

  openBrowserSession(url: string, sessionId: string, title = 'Browser'): DesktopTab | undefined { return this.openBrowser(url, { sessionId, title }); }
  browserState(tabId = this.currentTab?.id): DesktopBrowserRuntimeState | undefined {
    const state = tabId ? this.browserStates.get(tabId) : undefined;
    return state ? { ...state, page: state.page ? { ...state.page } : undefined } : undefined;
  }
  browserPage(tabId = this.currentTab?.id): DesktopBrowserPageState | undefined { return this.browserState(tabId)?.page; }
  setBrowserState(tabId: string, state: DesktopBrowserRuntimeState): void {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.kind !== 'browser') return;
    const previousUrl = tab.url;
    const page = state.page ? { ...state.page, tabId, url: sanitizeUrlForPersistence(state.page.url) ?? tab.url ?? 'about:blank', origin: safeBrowserOrigin(state.page.url), title: state.page.title.slice(0, 120), visibleText: state.page.visibleText?.slice(0, 8192), interactiveCount: Math.max(0, Math.min(512, state.page.interactiveCount ?? 0)) } : undefined;
    this.browserStates.set(tabId, { sessionId: state.sessionId ?? tab.browserSessionId, activity: state.activity ?? 'IDLE', paused: state.paused, page });
    this.tabs.update(tabId, { browserSessionId: state.sessionId ?? tab.browserSessionId, browserActivity: state.activity ?? 'IDLE', ...(page ? { url: page.url, title: page.title || tab.title, browserPageRevision: page.pageRevision, browserOrigin: page.origin, browserDataClass: page.dataClass } : {}) });
    if (page && previousUrl !== page.url) this.navigation.push({ tabId, url: page.url, title: page.title || tab.title });
    this.persistAndEmit();
  }
  setBrowserActivity(tabId: string, activity: NonNullable<DesktopTab['browserActivity']>, paused = false): void { this.setBrowserState(tabId, { ...this.browserState(tabId), activity, paused }); }
  applyBrowserActionResult(tabId: string, result: DesktopBrowserActionResult): void {
    this.setBrowserState(tabId, { sessionId: result.sessionId, activity: result.activity ?? (result.status === 'NEEDS_CONFIRMATION' ? 'NEEDS_CONFIRMATION' : result.status === 'FAILED' ? 'FAILED' : 'IDLE'), page: result.page, paused: result.status === 'NEEDS_CONFIRMATION' });
  }

  selectTab(paneId: string, tabId: string, recordNavigation = true): void { if (this.panes.setActiveTab(paneId, tabId)) { const tab = this.tabs.get(tabId); if (recordNavigation && tab) this.navigation.push({ tabId, ref: tab.object, url: tab.url, title: tab.title }); this.persistAndEmit(); } }
  focusTab(tabId: string, recordNavigation = true): void {
    const paneId = this.panes.findTabOwner(tabId);
    if (paneId) this.selectTab(paneId, tabId, recordNavigation);
  }
  closeTab(tabId: string, force = false): void {
    const tab = this.tabs.get(tabId);
    if (!tab || (!force && tab.pinned)) return;
    this.panes.removeTab(tabId);
    (force ? this.tabs.forceClose(tabId) : this.tabs.close(tabId));
    this.browserStates.delete(tabId);
    this.ensureActivePaneHasTab();
    this.persistAndEmit();
    if (!this.isPrimaryWindow && this.tabs.list().length === 0) {
      this.windowRegistry.remove(this.windowId, false);
      void Promise.resolve(this.windowBridge?.closeSelf?.());
    }
  }
  closeOtherTabs(keepTabId = this.currentTab?.id): void {
    if (!keepTabId) return;
    for (const tab of this.tabs.list()) {
      if (tab.id === keepTabId || tab.pinned) continue;
      this.panes.removeTab(tab.id);
      this.tabs.close(tab.id);
      this.browserStates.delete(tab.id);
    }
    this.ensureActivePaneHasTab();
    this.persistAndEmit();
  }
  closeActiveTab(): void { const tab = this.currentTab; if (tab) this.closeTab(tab.id); }
  reopenClosedTab(): void { const tab = this.tabs.reopen(); if (tab) { if (tab.kind === 'browser') this.hydrateBrowserTab(tab); this.panes.addTab(this.currentPaneId, tab.id, true); this.persistAndEmit(); } }
  duplicateTab(tabId = this.currentTab?.id): void { if (!tabId) return; const source = this.tabs.get(tabId); const tab = this.tabs.duplicate(tabId); if (tab) { if (tab.kind === 'browser') { const sessionId = `${source?.browserSessionId ?? 'browser-session'}-copy-${tab.id}`; this.tabs.update(tab.id, { browserSessionId: sessionId, browserActivity: 'IDLE', browserPageRevision: undefined, browserOrigin: undefined, browserDataClass: undefined }); this.browserStates.set(tab.id, { sessionId, activity: 'IDLE' }); } this.panes.addTab(this.currentPaneId, tab.id, true); this.persistAndEmit(); } }
  pinTab(tabId = this.currentTab?.id): void { if (tabId && this.tabs.pin(tabId, !this.tabs.get(tabId)?.pinned)) this.persistAndEmit(); }
  reorderTab(tabId: string, index: number): void { if (this.tabs.reorder(tabId, index)) this.persistAndEmit(); }

  async openTabInNewWindow(tabId = this.currentTab?.id, geometry?: DesktopWindowGeometry): Promise<boolean> {
    if (!tabId) return false;
    const tab = this.tabs.get(tabId);
    if (!tab || !this.windowBridge) { this.setNotice('Native Keystone windows are available in the desktop host.'); return false; }
    if (this.isPrimaryWindow && this.tabs.list().length <= 1) {
      this.setNotice('Keep one tab in the main window so Keystone always has a home.');
      return false;
    }
    const workspace = this.workspaceManager.current();
    const detached = this.windowRegistry.createDetached(workspace.id, tabId, geometry);
    if (!detached) return false;
    const taken = this.tabs.take(tabId);
    if (!taken) {
      this.windowRegistry.assignTab(workspace.id, tabId, this.windowId);
      return false;
    }
    this.panes.removeTab(tabId);
    this.ensureActivePaneHasTab();
    this.persistAndEmit();
    const opened = await Promise.resolve(this.windowBridge.open({
      windowId: detached.id,
      tabId,
      title: taken.title,
      ...(geometry?.x !== undefined ? { x: geometry.x } : {}),
      ...(geometry?.y !== undefined ? { y: geometry.y } : {}),
      ...(geometry?.width !== undefined ? { width: geometry.width } : {}),
      ...(geometry?.height !== undefined ? { height: geometry.height } : {}),
    })).catch(() => false);
    if (opened) {
      this.closeEmptySecondaryWindow();
      return true;
    }
    this.windowRegistry.remove(detached.id, false);
    this.windowRegistry.assignTab(workspace.id, tabId, this.windowId);
    this.tabs.open(taken, true);
    this.panes.addTab(this.currentPaneId, tabId, true);
    this.persistAndEmit();
    this.setNotice('The native Keystone window could not be opened.');
    return false;
  }

  async openReferenceInNewWindow(ref: KeystoneObjectReference, geometry?: DesktopWindowGeometry): Promise<boolean> {
    const existing = this.tabs.findByReference(ref);
    const tab = existing ?? this.openReference(ref, { allowDuplicate: true });
    return tab ? this.openTabInNewWindow(tab.id, geometry) : false;
  }

  transferTabToWindow(tabId: string, targetWindowId: string): boolean {
    return this.transferTabToWindowAt(tabId, targetWindowId);
  }

  transferTabToWindowAt(tabId: string, targetWindowId: string, targetIndex = Number.MAX_SAFE_INTEGER, transactionId?: string): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab || targetWindowId === this.windowId) return false;
    const workspace = this.workspaceManager.current();
    const committed = this.windowRegistry.transferTabAt(workspace.id, tabId, this.windowId, targetWindowId, targetIndex);
    if (!committed) return false;
    this.tabs.take(tabId);
    this.panes.removeTab(tabId);
    this.ensureActivePaneHasTab();
    this.persistAndEmit();
    void emitDesktopWindowTransfer({ type: 'committed', transactionId: transactionId ?? `context-${now()}-${tabId.slice(0, 24)}`, workspaceId: workspace.id, sourceWindowId: this.windowId, targetWindowId, tabId, targetIndex: committed.targetIndex });
    this.closeEmptySecondaryWindow();
    return true;
  }
  acceptWindowTransfer(payload: DesktopWindowTransferStart, targetIndex = Number.MAX_SAFE_INTEGER): boolean {
    if (payload.workspaceId !== this.workspaceManager.current().id || payload.sourceWindowId === this.windowId || payload.tabId !== payload.tab.id) return false;
    const workspace = this.workspaceManager.current();
    if (!workspace.tabs.some(tab => tab.id === payload.tabId)) return false;
    // The source may have committed another action since the drag started.
    // Re-read the canonical registry immediately before the ownership check.
    this.windowRegistry.reload();
    this.windowRegistry.ensureWorkspace(workspace);
    const committed = this.windowRegistry.transferTabAt(workspace.id, payload.tabId, payload.sourceWindowId, this.windowId, targetIndex);
    if (!committed) return false;
    this.refreshFromStorage();
    return true;
  }
  mergeWindowInto(targetWindowId: string): boolean {
    if (this.isPrimaryWindow || targetWindowId === this.windowId) return false;
    const workspace = this.workspaceManager.current();
    if (!this.windowRegistry.transferAllAt(workspace.id, this.windowId, targetWindowId)) return false;
    this.tabs = new TabManager([], this.tabs.closedTabs);
    this.panes = new PaneManager(paneTreeForTabs([]));
    this.persistRecord(this.capture());
    this.emit();
    this.closeEmptySecondaryWindow();
    return true;
  }
  lockObject(ref: KeystoneObjectReference): void { for (const tab of this.tabs.list()) if (tab.object?.kind === ref.kind && tab.object.id === ref.id) this.tabs.lock(tab.id, true); this.persistAndEmit(); }
  nextTab(direction: 1 | -1): void { const next = this.tabs.next(this.currentTab?.id ?? '', direction); if (next) this.selectTab(this.currentPaneId, next.id); }

  splitPane(orientation: PaneOrientation, paneId = this.currentPaneId): void { const newPaneId = this.panes.split(paneId, orientation); if (newPaneId) { this.persistAndEmit(); } else this.setNotice('Split depth limit reached.'); }
  closePane(paneId = this.currentPaneId): void { if (this.panes.close(paneId)) { this.persistAndEmit(); } }
  focusPane(paneId: string): void { if (this.panes.leaf(paneId)) { const record = this.capture(); record.activePaneId = paneId; this.chrome = record.chrome; this.persistRecord(record); this.emit(); } }
  moveTab(tabId: string, paneId: string): void { if (this.panes.moveTab(tabId, paneId)) this.persistAndEmit(); }
  resizePane(splitId: string, ratio: number): void { if (this.panes.resize(splitId, ratio)) this.persistAndEmit(); }

  toggleContextSidebar(force?: boolean): void { this.chrome.contextSidebarOpen = force ?? !this.chrome.contextSidebarOpen; this.persistAndEmit(); }
  toggleAgentPanel(force?: boolean): void { this.chrome.agentPanelOpen = force ?? !this.chrome.agentPanelOpen; this.persistAndEmit(); }
  toggleWorkspaceMenu(): void { this.setNotice('Choose a workspace from the workspace switcher.'); }
  get chromeState(): WorkspaceChromeState { return JSON.parse(JSON.stringify(this.chrome)) as WorkspaceChromeState; }
  updateActivityBar(items: ActivityBarItem[]): void { this.chrome.activityBar = items.slice(0, 32).map(item => ({ ...item })); this.persistAndEmit(); }
  setActivityVisible(itemId: string, visible: boolean): void { this.chrome.activityBar = this.chrome.activityBar.map(item => item.id === itemId ? { ...item, visible } : item); this.persistAndEmit(); }
  setActivityPinned(itemId: string, pinned: boolean): void { this.chrome.activityBar = this.chrome.activityBar.map(item => item.id === itemId ? { ...item, pinned } : item); this.persistAndEmit(); }
  reorderActivity(itemId: string, index: number): void { const items = [...this.chrome.activityBar]; const from = items.findIndex(item => item.id === itemId); if (from < 0) return; const [item] = items.splice(from, 1); items.splice(Math.max(0, Math.min(items.length, index)), 0, item); this.chrome.activityBar = items; this.persistAndEmit(); }

  createWorkspace(name: string): void { this.workspaceManager.save(this.capture()); const record = this.workspaceManager.create(name); this.loadRecord(record); this.emit(); }
  renameWorkspace(name: string): void { this.workspaceManager.rename(this.capture().id, name); this.persistAndEmit(); }
  removeWorkspace(): void { if (this.workspaceManager.remove(this.capture().id)) this.loadRecord(this.workspaceManager.current()); this.emit(); }
  switchWorkspace(workspaceId: string): void { this.workspaceManager.save(this.capture()); const record = this.workspaceManager.switch(workspaceId); if (record) this.loadRecord(record); this.emit(); }
  listWorkspaces(): WorkspaceRecord[] { return this.workspaceManager.list(); }

  goBack(): void { const entry = this.navigation.back(); if (entry) this.activateNavigationEntry(entry); }
  goForward(): void { const entry = this.navigation.forward(); if (entry) this.activateNavigationEntry(entry); }
  private activateNavigationEntry(entry: NavigationEntry): void { if (entry.tabId && this.tabs.get(entry.tabId)) { const owner = this.panes.findTabOwner(entry.tabId); if (owner) { this.focusPane(owner); this.selectTab(owner, entry.tabId, false); } return; } if (entry.ref) this.openReference(entry.ref); else if (entry.url) this.openBrowser(entry.url); }

  private capture(): WorkspaceRecord {
    const workspace = this.workspaceManager.current();
    const activePaneId = this.panes.leaf(workspace.activePaneId) ? workspace.activePaneId : this.panes.firstPaneId();
    return { id: workspace.id, name: workspace.name, tabs: this.tabs.list(), closedTabs: this.tabs.closedTabs, paneTree: this.panes.tree, activePaneId, chrome: this.chromeState, updatedAt: now() };
  }
  private loadRecord(record: WorkspaceRecord): void {
    this.windowRegistry.ensureWorkspace(record);
    const windowRecord = this.windowRegistry.prepareWindow(this.windowId, record);
    if (windowRecord) this.loadWindowRecord(record, windowRecord);
  }
  private loadWindowRecord(record: WorkspaceRecord, windowRecord: DesktopWindowRecord): void {
    const visibleIds = new Set(windowRecord.tabIds);
    const visibleTabs = windowRecord.tabIds.flatMap(tabId => record.tabs.filter(tab => tab.id === tabId));
    const initialTabs = visibleIds.size === 0 && this.isPrimaryWindow ? [] : visibleTabs;
    this.tabs = new TabManager(initialTabs, record.closedTabs);
    const paneTree = this.isPrimaryWindow
      ? filterPaneTabs(record.paneTree, new Set(initialTabs.map(tab => tab.id)))
      : windowRecord.paneTree
        ? filterPaneTabs(windowRecord.paneTree, new Set(initialTabs.map(tab => tab.id)))
        : paneTreeForTabs(initialTabs);
    this.panes = new PaneManager(paneTree);
    for (const tab of initialTabs) if (!this.panes.findTabOwner(tab.id)) this.panes.addTab(this.panes.firstPaneId(), tab.id, false);
    this.chrome = JSON.parse(JSON.stringify(windowRecord.chrome ?? record.chrome)) as WorkspaceChromeState;
    this.ownedTabIds = new Set(windowRecord.tabIds);
    this.browserStates.clear();
    for (const tab of initialTabs) if (tab.kind === 'browser') this.hydrateBrowserTab(tab);
    this.revalidateTabs();
    this.ensureActivePaneHasTab();
  }
  private hydrateBrowserTab(tab: DesktopTab): void { if (tab.kind !== 'browser') return; this.browserStates.set(tab.id, { sessionId: tab.browserSessionId, activity: tab.browserActivity ?? 'IDLE', page: tab.browserPageRevision !== undefined && tab.url ? { tabId: tab.id, url: tab.url, origin: safeBrowserOrigin(tab.url), title: tab.title, pageRevision: tab.browserPageRevision, dataClass: tab.browserDataClass ?? 'PUBLIC' } : undefined }); }
  private revalidateTabs(): void { for (const tab of this.tabs.list()) { if (!tab.object) continue; const route = this.router.open(referenceUrl(tab.object)); if (route.kind === 'locked') this.tabs.lock(tab.id, true); } }
  private ensureActivePaneHasTab(): void {
    const tabs = this.tabs.list();
    if (this.isPrimaryWindow && tabs.length === 0) {
      const home = tabForReference({ kind: 'home', id: 'home', label: 'Home' }, { pinned: true });
      this.tabs.open(home, false);
      this.panes = new PaneManager(paneTreeForTabs([home]));
      return;
    }
    for (const pane of this.panes.leaves) if (pane.tabIds.length === 0 && tabs.length) this.panes.addTab(pane.id, tabs[0].id, true);
  }
  private restoreStartupSurface(): void {
    const preference = this.startupPreference;
    if (preference.surface === 'last-opened') return;
    const refs: Partial<Record<Exclude<DesktopStartupSurface, 'last-opened' | 'workspace'>, KeystoneObjectReference>> = {
      home: { kind: 'home', id: 'home', label: 'Home' }, feed: { kind: 'media', id: 'feed', label: 'Feed' }, video: { kind: 'video', id: 'video', label: 'Video' }, messages: { kind: 'chat', id: 'messages', label: 'Messages' }, storage: { kind: 'file', id: 'storage', label: 'Storage' }, calendar: { kind: 'calendar', id: 'calendar', label: 'Calendar' }, mail: { kind: 'mail', id: 'mail', label: 'External Email' }, vault: { kind: 'vault', id: 'vault', label: 'Vault' },
    };
    const home = refs.home;
    if (!home) return;
    const ref = preference.surface === 'workspace' ? preference.target : refs[preference.surface];
    if (!ref) {
      // A deleted or no-longer-authorized custom target must never make the
      // shell unusable. Keep the owner's preference durable so a restored
      // workspace can be tried again later, but open the safe Home surface
      // for this launch.
      if (preference.surface === 'workspace') this.openReference(home);
      return;
    }
    const opened = this.openReference(ref);
    if (!opened && preference.surface !== 'home') this.openReference(home);
  }
  private persistRecord(record: WorkspaceRecord): void {
    const canonical = this.workspaceManager.current();
    const visibleTabs = record.tabs;
    const visibleIds = new Set(visibleTabs.map(tab => tab.id));
    const otherWindowTabIds = new Set(this.windowRegistry.list(canonical.id).filter(window => window.id !== this.windowId).flatMap(window => window.tabIds));
    const otherTabs = canonical.tabs.filter(tab => !this.ownedTabIds.has(tab.id) || otherWindowTabIds.has(tab.id));
    const ordered = this.isPrimaryWindow ? [...visibleTabs, ...otherTabs] : [...otherTabs, ...visibleTabs];
    const merged = [...new Map(ordered.map(tab => [tab.id, tab])).values()];
    const saved: WorkspaceRecord = {
      ...canonical,
      id: record.id,
      name: record.name,
      tabs: merged,
      closedTabs: this.isPrimaryWindow ? record.closedTabs : canonical.closedTabs,
      ...(this.isPrimaryWindow ? { paneTree: record.paneTree, activePaneId: record.activePaneId, chrome: record.chrome } : {}),
      updatedAt: now(),
    };
    this.workspaceManager.save(saved);
    this.windowRegistry.update(this.windowId, {
      workspaceId: saved.id,
      tabIds: [...visibleIds],
      activeTabId: this.currentTab?.id,
      paneTree: record.paneTree,
      activePaneId: record.activePaneId,
      chrome: record.chrome,
    });
    this.ownedTabIds = new Set(visibleIds);
  }
  private persistAndEmit(): void { this.persistRecord(this.capture()); this.emit(); }
  private closeEmptySecondaryWindow(): void {
    if (this.isPrimaryWindow || this.tabs.list().length > 0) return;
    this.windowRegistry.remove(this.windowId, false);
    void Promise.resolve(this.windowBridge?.closeSelf?.());
  }
  private emit(): void { for (const listener of this.listeners) listener(); }
}

function referenceUrl(ref: KeystoneObjectReference): string {
  if (ref.kind === 'graph' && ref.vaultId) return `keystone://vault/${encodeURIComponent(ref.vaultId)}/graph`;
  if (ref.kind === 'canvas' && ref.vaultId) return `keystone://vault/${encodeURIComponent(ref.vaultId)}/canvas/${encodeURIComponent(ref.id)}`;
  return keystoneLinkForReference(ref);
}

class MemoryStorage implements DesktopStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

let memoryStorage: DesktopStorage | undefined;
export function defaultStorage(): DesktopStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  memoryStorage ??= new MemoryStorage();
  return memoryStorage;
}

export function isPrimaryModifier(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform) ? event.metaKey : event.ctrlKey;
}

export function parseKeystoneLink(input: string): KeystoneObjectReference | undefined {
  const result = new KeystoneLinkRouter().resolve(input);
  return result.kind === 'object' ? result.ref : undefined;
}

/**
 * Return the canonical, non-bearer URL for a shell reference.
 *
 * Route links intentionally use short, stable names while object links keep
 * the typed object identity.  The URL never contains payloads, credentials or
 * permission material, so it is safe to copy between Keystone surfaces.
 */
export function keystoneLinkForReference(ref: KeystoneObjectReference): string {
  const routeAliases: Partial<Record<DesktopObjectKind, string>> = {
    home: 'home',
    settings: ref.id === 'search' ? 'search' : ref.id === 'device' ? 'devices' : ref.id === 'settings' ? 'settings' : undefined,
    music: ref.id === 'music' ? 'music' : undefined,
    video: ref.id === 'video' ? 'video' : undefined,
    shorts: ref.id === 'shorts' ? 'shorts' : undefined,
    file: ref.id === 'files' || ref.id === 'storage' ? 'files' : undefined,
    document: ref.id === 'documents' ? 'documents' : undefined,
    tasks: ref.id === 'tasks' ? 'tasks' : undefined,
    capture: ref.id === 'capture' ? 'capture' : undefined,
    ai: ref.id === 'ai' ? 'ai' : undefined,
    network: ref.id === 'network' ? 'network' : undefined,
  };
  const route = routeAliases[ref.kind];
  if (route) return `keystone://${route}`;
  if (ref.kind === 'tasks') return `keystone://task/${encodeURIComponent(ref.id)}`;
  if (ref.kind === 'chat') return `keystone://conversation/${encodeURIComponent(ref.id)}`;
  if (ref.kind === 'vault' && ref.vaultId && ref.id !== ref.vaultId) return `keystone://vault/${encodeURIComponent(ref.vaultId)}/note/${encodeURIComponent(ref.id)}`;
  if (ref.kind === 'publication' && ref.revisionAddress) return `keystone://publication/${encodeURIComponent(ref.id)}/revision/${ref.revisionAddress}`;
  return `keystone://${ref.kind}/${encodeURIComponent(ref.id)}`;
}
