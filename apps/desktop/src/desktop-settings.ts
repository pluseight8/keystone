import { defaultStorage, type DesktopStorage } from './desktop-shell-model';

/**
 * Canonical desktop personalization model.
 *
 * The registry is deliberately small and semantic.  It describes real shell
 * consumers; object payloads, credentials and security policy do not belong
 * here.  The persisted document is versioned so adding a control does not
 * require throwing away an owner's previous setup.
 */

export type DesktopTheme = 'system' | 'light' | 'dark';
export type DesktopAccent = 'rose' | 'blue' | 'violet' | 'amber' | 'green' | 'custom';
export type DesktopDensity = 'comfortable' | 'compact';
export type DesktopRadiusPreset = 'square' | 'subtle' | 'rounded';
export type DesktopShadowPreset = 'off' | 'subtle' | 'default' | 'strong';
export type DesktopMotionMode = 'full' | 'reduced' | 'off';
export type DesktopMotionEasing = 'standard' | 'smooth' | 'snappy';
export type DesktopTabStyle = 'connected' | 'separated' | 'minimal';
export type DesktopTabCloseButtons = 'always' | 'hover' | 'active';
export type DesktopSidebarSide = 'left' | 'right';
export type DesktopSettingScope = 'global' | 'device' | 'workspace' | 'surface' | 'window' | 'session';
export type DesktopSecurityClass = 'USER_PREFERENCE' | 'PRIVACY_SETTING' | 'SECURITY_SETTING' | 'IMMUTABLE_POLICY';
export type DesktopRestartRequirement = 'none' | 'restart';
export type DesktopSettingType = 'boolean' | 'number' | 'string' | 'enum' | 'color' | 'keybinding' | 'json';
export type DesktopSettingCategory = 'general' | 'appearance' | 'layout' | 'navigation' | 'home' | 'tabs' | 'sidebars' | 'toolbars' | 'motion' | 'shortcuts' | 'behavior' | 'applications' | 'security' | 'advanced';

export type HomeSectionId = 'continue' | 'today' | 'recent' | 'pinned';

export interface DesktopColorOverrides {
  background?: string;
  surface?: string;
  surfaceElevated?: string;
  sidebar?: string;
  toolbar?: string;
  tabbar?: string;
  primaryText?: string;
  secondaryText?: string;
  border?: string;
  accent?: string;
  selection?: string;
  focus?: string;
  success?: string;
  warning?: string;
  danger?: string;
}

export interface DesktopSettingValueMap {
  'general.startup': 'last-opened' | 'home';
  'general.locale': 'en' | 'ru';
  'appearance.theme': DesktopTheme;
  'appearance.accent': DesktopAccent;
  'appearance.customAccent': string;
  'appearance.colors': DesktopColorOverrides;
  'appearance.density': DesktopDensity;
  'appearance.uiScale': number;
  'appearance.baseFontSize': number;
  'appearance.headingScale': number;
  'appearance.lineHeight': number;
  'appearance.letterSpacing': number;
  'appearance.monospaceFont': string;
  'appearance.radiusPreset': DesktopRadiusPreset;
  'appearance.controlRadius': number;
  'appearance.panelRadius': number;
  'appearance.menuRadius': number;
  'appearance.modalRadius': number;
  'appearance.tabRadius': number;
  'appearance.pillRadius': number;
  'appearance.borderWidth': number;
  'appearance.borderOpacity': number;
  'appearance.dividers': boolean;
  'appearance.shadowPreset': DesktopShadowPreset;
  'appearance.shadowOpacity': number;
  'appearance.shadowBlur': number;
  'appearance.transparency': number;
  'appearance.blur': number;
  'layout.activityBarVisible': boolean;
  'layout.activityBarPosition': DesktopSidebarSide;
  'layout.activityBarWidth': number;
  'layout.sidebarVisible': boolean;
  'layout.sidebarPosition': DesktopSidebarSide;
  'layout.sidebarWidth': number;
  'layout.inspectorVisible': boolean;
  'layout.inspectorPosition': DesktopSidebarSide;
  'layout.inspectorWidth': number;
  'layout.omniboxVisible': boolean;
  'layout.breadcrumbsVisible': boolean;
  'layout.workspaceSelectorVisible': boolean;
  'layout.quickCaptureButtonVisible': boolean;
  'layout.commandPaletteButtonVisible': boolean;
  'layout.newButtonVisible': boolean;
  'layout.statusBarVisible': boolean;
  'layout.toolbarHeight': number;
  'layout.tabHeight': number;
  'layout.statusBarHeight': number;
  'layout.contentMaxWidth': number;
  'home.sectionOrder': HomeSectionId[];
  'home.hiddenSections': HomeSectionId[];
  'home.density': DesktopDensity;
  'home.emptyPriority': 'quick-capture' | 'new-document' | 'tasks' | 'search' | 'ai' | 'media';
  'tabs.style': DesktopTabStyle;
  'tabs.showIcons': boolean;
  'tabs.closeButtons': DesktopTabCloseButtons;
  'tabs.middleClickClose': boolean;
  'tabs.doubleClickAction': 'none' | 'close' | 'new-tab';
  'tabs.newTabPlacement': 'end' | 'next-to-current';
  'tabs.restoreTabs': boolean;
  'tabs.recentlyUsedSwitching': boolean;
  'tabs.tearOffEnabled': boolean;
  'tabs.detachThreshold': number;
  'tabs.minWidth': number;
  'tabs.maxWidth': number;
  'tabs.preview': boolean;
  'motion.mode': DesktopMotionMode;
  'motion.speed': number;
  'motion.easing': DesktopMotionEasing;
  'shortcuts.commandPalette': string;
  'shortcuts.quit': string;
  'shortcuts.focusOmnibox': string;
  'shortcuts.quickCapture': string;
  'shortcuts.closeTab': string;
  'shortcuts.newTab': string;
  'shortcuts.reopenTab': string;
  'shortcuts.toggleSidebar': string;
  'shortcuts.customize': string;
  'behavior.persistSortFilters': boolean;
  'behavior.closeSecondaryWithLastTab': boolean;
  'behavior.openLinksInNewWindow': boolean;
  'behavior.restoreWindows': boolean;
  'security.allowRemoteScripts': boolean;
  'advanced.customCssEnabled': boolean;
  'advanced.customCss': string;
}

export type DesktopSettingId = keyof DesktopSettingValueMap;
export type DesktopSettingValue = DesktopSettingValueMap[DesktopSettingId];
export type DesktopPresetId = 'keystone-default' | 'compact' | 'comfortable' | 'minimal';

export interface DesktopSettingDefinition<K extends DesktopSettingId = DesktopSettingId> {
  readonly id: K;
  readonly category: DesktopSettingCategory;
  readonly subcategory: string;
  readonly label: { readonly en: string; readonly ru: string };
  readonly description: { readonly en: string; readonly ru: string };
  readonly type: DesktopSettingType;
  readonly default: DesktopSettingValueMap[K];
  readonly allowedValues?: readonly unknown[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly scope: DesktopSettingScope;
  readonly securityClass: DesktopSecurityClass;
  readonly restartRequirement: DesktopRestartRequirement;
  readonly searchKeywords: readonly string[];
  readonly visibility?: 'basic' | 'advanced';
  readonly dependency?: DesktopSettingId;
}

export interface DesktopSettingsContext {
  readonly deviceId?: string;
  readonly workspaceId?: string;
  readonly surfaceId?: string;
  readonly windowId?: string;
}

export interface DesktopSettingsDocument {
  version: 2;
  global: Partial<DesktopSettingValueMap>;
  devices: Record<string, Partial<DesktopSettingValueMap>>;
  workspaces: Record<string, Partial<DesktopSettingValueMap>>;
  surfaces: Record<string, Partial<DesktopSettingValueMap>>;
  windows: Record<string, Partial<DesktopSettingValueMap>>;
  customCss: { enabled: boolean; css: string };
}

export interface DesktopSettingsSnapshot {
  readonly values: DesktopSettingValueMap;
  readonly sources: Record<DesktopSettingId, DesktopSettingScope | 'default'>;
  readonly document: DesktopSettingsDocument;
  readonly context: DesktopSettingsContext;
}

export interface DesktopShortcutConflict {
  readonly shortcut: string;
  readonly ids: readonly DesktopSettingId[];
}

export interface DesktopSettingMutation {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
}

export interface DesktopSettingsImportPreview {
  readonly ok: boolean;
  readonly version?: number;
  readonly changes: readonly { readonly id: DesktopSettingId; readonly value: unknown; readonly scope: DesktopSettingScope }[];
  readonly conflicts: readonly string[];
  readonly errors: readonly string[];
}

export const DESKTOP_SETTINGS_KEY = 'keystone.desktop.settings.v2';
export const DESKTOP_CUSTOM_CSS_KEY = 'keystone.desktop.custom-css.v1';
export const DESKTOP_SESSION_RESTORE_POLICY_KEY = 'keystone.desktop.session-restore-policy.v1';

/** Automatic session restore is an explicit opt-in during desktop recovery. */
export function isDesktopSessionRestoreEnabled(storage: DesktopStorage = defaultStorage()): boolean {
  try {
    const raw = storage.getItem(DESKTOP_SESSION_RESTORE_POLICY_KEY);
    if (!raw) return false;
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) && value.version === 1 && value.enabled === true;
  } catch {
    return false;
  }
}

export function setDesktopSessionRestoreEnabled(storage: DesktopStorage = defaultStorage(), enabled = false): void {
  try { storage.setItem(DESKTOP_SESSION_RESTORE_POLICY_KEY, JSON.stringify({ version: 1, enabled: enabled === true })); } catch { /* optional storage */ }
}

export const DESKTOP_ACCENTS: Readonly<Record<Exclude<DesktopAccent, 'custom'>, { readonly label: string; readonly value: string }>> = {
  rose: { label: 'Rose', value: '#e9254d' },
  blue: { label: 'Blue', value: '#5d8df6' },
  violet: { label: 'Violet', value: '#9b7cf4' },
  amber: { label: 'Amber', value: '#d6a35e' },
  green: { label: 'Green', value: '#65c898' },
};

const DEFAULT_COLORS: DesktopColorOverrides = {
  background: '#09090a',
  surface: '#111113',
  surfaceElevated: '#17171a',
  sidebar: '#0d0d0f',
  toolbar: '#101012',
  tabbar: '#0b0b0d',
  primaryText: '#f4f4f5',
  secondaryText: '#98989f',
  border: '#2a2a2e',
  accent: '#e9254d',
  selection: '#e9254d',
  focus: '#e9254d',
  success: '#65c898',
  warning: '#d5a55c',
  danger: '#ef6b7d',
};

const LIGHT_COLORS: DesktopColorOverrides = {
  background: '#f5f7f9',
  surface: '#ffffff',
  surfaceElevated: '#eef1f4',
  sidebar: '#f0f3f6',
  toolbar: '#f8fafb',
  tabbar: '#eef1f4',
  primaryText: '#1b232c',
  secondaryText: '#586674',
  border: '#d5dce4',
  accent: '#e9254d',
  selection: '#e9254d',
  focus: '#e9254d',
  success: '#218a5b',
  warning: '#94651c',
  danger: '#b4233f',
};

export function desktopThemeColors(theme: 'light' | 'dark'): DesktopColorOverrides {
  return theme === 'light' ? LIGHT_COLORS : DEFAULT_COLORS;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettingValueMap = {
  'general.startup': 'last-opened',
  'general.locale': 'ru',
  'appearance.theme': 'system',
  'appearance.accent': 'rose',
  'appearance.customAccent': '#e9254d',
  'appearance.colors': {},
  'appearance.density': 'comfortable',
  'appearance.uiScale': 1,
  'appearance.baseFontSize': 14,
  'appearance.headingScale': 1,
  'appearance.lineHeight': 1.4,
  'appearance.letterSpacing': 0,
  'appearance.monospaceFont': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  'appearance.radiusPreset': 'subtle',
  'appearance.controlRadius': 7,
  'appearance.panelRadius': 9,
  'appearance.menuRadius': 9,
  'appearance.modalRadius': 10,
  'appearance.tabRadius': 6,
  'appearance.pillRadius': 999,
  'appearance.borderWidth': 1,
  'appearance.borderOpacity': 1,
  'appearance.dividers': true,
  'appearance.shadowPreset': 'default',
  'appearance.shadowOpacity': 0.5,
  'appearance.shadowBlur': 48,
  'appearance.transparency': 0,
  'appearance.blur': 0,
  'layout.activityBarVisible': true,
  'layout.activityBarPosition': 'left',
  'layout.activityBarWidth': 72,
  'layout.sidebarVisible': true,
  'layout.sidebarPosition': 'right',
  'layout.sidebarWidth': 280,
  'layout.inspectorVisible': false,
  'layout.inspectorPosition': 'right',
  'layout.inspectorWidth': 360,
  'layout.omniboxVisible': true,
  'layout.breadcrumbsVisible': false,
  'layout.workspaceSelectorVisible': true,
  'layout.quickCaptureButtonVisible': true,
  'layout.commandPaletteButtonVisible': true,
  'layout.newButtonVisible': true,
  'layout.statusBarVisible': false,
  'layout.toolbarHeight': 56,
  'layout.tabHeight': 42,
  'layout.statusBarHeight': 30,
  'layout.contentMaxWidth': 1400,
  'home.sectionOrder': ['continue', 'today', 'recent', 'pinned'],
  'home.hiddenSections': [],
  'home.density': 'comfortable',
  'home.emptyPriority': 'quick-capture',
  'tabs.style': 'connected',
  'tabs.showIcons': true,
  'tabs.closeButtons': 'hover',
  'tabs.middleClickClose': true,
  'tabs.doubleClickAction': 'none',
  'tabs.newTabPlacement': 'next-to-current',
  'tabs.restoreTabs': false,
  'tabs.recentlyUsedSwitching': true,
  'tabs.tearOffEnabled': true,
  'tabs.detachThreshold': 48,
  'tabs.minWidth': 112,
  'tabs.maxWidth': 240,
  'tabs.preview': true,
  'motion.mode': 'full',
  'motion.speed': 1,
  'motion.easing': 'standard',
  'shortcuts.commandPalette': 'Ctrl+K',
  'shortcuts.quit': 'Ctrl+Q',
  'shortcuts.focusOmnibox': 'Ctrl+L',
  'shortcuts.quickCapture': 'Ctrl+Shift+Space',
  'shortcuts.closeTab': 'Ctrl+W',
  'shortcuts.newTab': 'Ctrl+T',
  'shortcuts.reopenTab': 'Ctrl+Shift+T',
  'shortcuts.toggleSidebar': 'Ctrl+B',
  'shortcuts.customize': 'Ctrl+,',
  'behavior.persistSortFilters': true,
  'behavior.closeSecondaryWithLastTab': true,
  'behavior.openLinksInNewWindow': false,
  'behavior.restoreWindows': false,
  'security.allowRemoteScripts': false,
  'advanced.customCssEnabled': false,
  'advanced.customCss': '',
};

export const DESKTOP_PRESETS: Readonly<Record<DesktopPresetId, Partial<DesktopSettingValueMap>>> = {
  'keystone-default': {},
  compact: { 'appearance.density': 'compact', 'home.density': 'compact', 'layout.sidebarWidth': 232, 'layout.activityBarWidth': 68, 'layout.toolbarHeight': 32, 'layout.tabHeight': 29, 'layout.statusBarHeight': 25 },
  comfortable: { 'appearance.density': 'comfortable', 'home.density': 'comfortable', 'layout.sidebarWidth': 300, 'layout.activityBarWidth': 82, 'layout.toolbarHeight': 40, 'layout.tabHeight': 35, 'layout.statusBarHeight': 30 },
  minimal: { 'layout.activityBarVisible': false, 'layout.sidebarVisible': false, 'layout.inspectorVisible': false, 'layout.breadcrumbsVisible': false, 'layout.commandPaletteButtonVisible': false, 'layout.newButtonVisible': false, 'layout.statusBarVisible': false, 'appearance.density': 'compact', 'home.density': 'compact' },
};

const enumDefinition = <K extends DesktopSettingId>(id: K, category: DesktopSettingCategory, subcategory: string, en: string, ru: string, descriptionEn: string, descriptionRu: string, value: DesktopSettingValueMap[K], allowedValues: readonly unknown[], scope: DesktopSettingScope = 'global', visibility: 'basic' | 'advanced' = 'basic'): DesktopSettingDefinition<K> => ({ id, category, subcategory, label: { en, ru }, description: { en: descriptionEn, ru: descriptionRu }, type: 'enum', default: value, allowedValues, scope, securityClass: 'USER_PREFERENCE', restartRequirement: 'none', searchKeywords: [id, en, ru, subcategory], visibility });
const booleanDefinition = <K extends DesktopSettingId>(id: K, category: DesktopSettingCategory, subcategory: string, en: string, ru: string, descriptionEn: string, descriptionRu: string, value: DesktopSettingValueMap[K], scope: DesktopSettingScope = 'global', visibility: 'basic' | 'advanced' = 'basic'): DesktopSettingDefinition<K> => ({ id, category, subcategory, label: { en, ru }, description: { en: descriptionEn, ru: descriptionRu }, type: 'boolean', default: value, scope, securityClass: 'USER_PREFERENCE', restartRequirement: 'none', searchKeywords: [id, en, ru, subcategory], visibility });
const numberDefinition = <K extends DesktopSettingId>(id: K, category: DesktopSettingCategory, subcategory: string, en: string, ru: string, descriptionEn: string, descriptionRu: string, value: DesktopSettingValueMap[K], min: number, max: number, step: number, unit: string, scope: DesktopSettingScope = 'global', visibility: 'basic' | 'advanced' = 'basic'): DesktopSettingDefinition<K> => ({ id, category, subcategory, label: { en, ru }, description: { en: descriptionEn, ru: descriptionRu }, type: 'number', default: value, min, max, step, unit, scope, securityClass: 'USER_PREFERENCE', restartRequirement: 'none', searchKeywords: [id, en, ru, subcategory], visibility });
const stringDefinition = <K extends DesktopSettingId>(id: K, category: DesktopSettingCategory, subcategory: string, en: string, ru: string, descriptionEn: string, descriptionRu: string, value: DesktopSettingValueMap[K], type: DesktopSettingType = 'string', scope: DesktopSettingScope = 'global', visibility: 'basic' | 'advanced' = 'advanced'): DesktopSettingDefinition<K> => ({ id, category, subcategory, label: { en, ru }, description: { en: descriptionEn, ru: descriptionRu }, type, default: value, scope, securityClass: 'USER_PREFERENCE', restartRequirement: 'none', searchKeywords: [id, en, ru, subcategory], visibility });

export const DESKTOP_SETTING_REGISTRY: readonly DesktopSettingDefinition[] = [
  enumDefinition('general.startup', 'general', 'Startup', 'Startup behavior', 'Поведение запуска', 'Restore your last local session or open Home.', 'Восстанавливать локальную сессию или открывать Главную.', DEFAULT_DESKTOP_SETTINGS['general.startup'], ['last-opened', 'home']),
  enumDefinition('general.locale', 'general', 'Language', 'Interface language', 'Язык интерфейса', 'Choose the language used by the desktop shell.', 'Выберите язык интерфейса.', DEFAULT_DESKTOP_SETTINGS['general.locale'], ['en', 'ru']),
  enumDefinition('appearance.theme', 'appearance', 'Theme', 'Theme', 'Тема', 'Use the system theme or choose Light or Dark.', 'Используйте тему системы или выберите светлую/тёмную.', DEFAULT_DESKTOP_SETTINGS['appearance.theme'], ['system', 'light', 'dark']),
  enumDefinition('appearance.accent', 'appearance', 'Theme', 'Accent', 'Акцент', 'Apply a restrained accent to controls and focus states.', 'Применяет сдержанный акцент к элементам управления и фокусу.', DEFAULT_DESKTOP_SETTINGS['appearance.accent'], ['rose', 'blue', 'violet', 'amber', 'green', 'custom']),
  stringDefinition('appearance.customAccent', 'appearance', 'Theme', 'Custom accent color', 'Свой цвет акцента', 'A six-digit local color used by the shell.', 'Шестизначный локальный цвет для оболочки.', DEFAULT_DESKTOP_SETTINGS['appearance.customAccent'], 'color', 'global', 'advanced'),
  stringDefinition('appearance.colors', 'appearance', 'Colors', 'Semantic color overrides', 'Семантические цвета', 'Advanced light/dark semantic color values; presentation only.', 'Расширенные семантические цвета светлой/тёмной темы; только оформление.', DEFAULT_DESKTOP_SETTINGS['appearance.colors'], 'json', 'global', 'advanced'),
  enumDefinition('appearance.density', 'appearance', 'Density', 'Interface density', 'Плотность интерфейса', 'Change shell spacing while keeping controls usable.', 'Меняет отступы оболочки, сохраняя удобные размеры элементов управления.', DEFAULT_DESKTOP_SETTINGS['appearance.density'], ['comfortable', 'compact']),
  numberDefinition('appearance.uiScale', 'appearance', 'Typography', 'UI scale', 'Масштаб интерфейса', 'Scale shell typography and geometry from 80% to 140%.', 'Масштабирует текст и геометрию оболочки от 80% до 140%.', DEFAULT_DESKTOP_SETTINGS['appearance.uiScale'], 0.8, 1.4, 0.05, '×'),
  numberDefinition('appearance.baseFontSize', 'appearance', 'Typography', 'Base font size', 'Базовый размер шрифта', 'Set the shell base size in a safe range.', 'Задайте базовый размер оболочки в безопасном диапазоне.', DEFAULT_DESKTOP_SETTINGS['appearance.baseFontSize'], 11, 18, 1, 'px', 'global', 'advanced'),
  numberDefinition('appearance.headingScale', 'appearance', 'Typography', 'Heading scale', 'Масштаб заголовков', 'Adjust headings relative to the shell base size.', 'Настройте заголовки относительно базового размера оболочки.', DEFAULT_DESKTOP_SETTINGS['appearance.headingScale'], 0.85, 1.35, 0.05, '×', 'global', 'advanced'),
  numberDefinition('appearance.lineHeight', 'appearance', 'Typography', 'Line height', 'Высота строки', 'Adjust readable line height for descriptions and lists.', 'Настройте высоту строки для описаний и списков.', DEFAULT_DESKTOP_SETTINGS['appearance.lineHeight'], 1.2, 1.8, 0.05, '', 'global', 'advanced'),
  numberDefinition('appearance.letterSpacing', 'appearance', 'Typography', 'Letter spacing', 'Межбуквенный интервал', 'Adjust shell letter spacing in em units.', 'Настройте межбуквенный интервал оболочки в em.', DEFAULT_DESKTOP_SETTINGS['appearance.letterSpacing'], -0.03, 0.08, 0.005, 'em', 'global', 'advanced'),
  stringDefinition('appearance.monospaceFont', 'appearance', 'Typography', 'Monospace font', 'Моноширинный шрифт', 'Use a local installed fallback stack for code and IDs.', 'Используйте локальный резервный шрифт для кода и идентификаторов.', DEFAULT_DESKTOP_SETTINGS['appearance.monospaceFont'], 'string', 'device', 'advanced'),
  enumDefinition('appearance.radiusPreset', 'appearance', 'Shape', 'Corner style', 'Стиль углов', 'Choose square, subtle, or rounded surfaces.', 'Выберите квадратные, сдержанные или округлые поверхности.', DEFAULT_DESKTOP_SETTINGS['appearance.radiusPreset'], ['square', 'subtle', 'rounded']),
  numberDefinition('appearance.controlRadius', 'appearance', 'Shape', 'Control radius', 'Радиус элементов управления', 'Radius of buttons and inputs.', 'Радиус кнопок и полей ввода.', DEFAULT_DESKTOP_SETTINGS['appearance.controlRadius'], 0, 20, 1, 'px', 'global', 'advanced'),
  numberDefinition('appearance.panelRadius', 'appearance', 'Shape', 'Panel radius', 'Радиус панелей', 'Radius of cards and panels.', 'Радиус карточек и панелей.', DEFAULT_DESKTOP_SETTINGS['appearance.panelRadius'], 0, 28, 1, 'px', 'global', 'advanced'),
  numberDefinition('appearance.menuRadius', 'appearance', 'Shape', 'Menu radius', 'Радиус меню', 'Radius of menus and popovers.', 'Радиус меню и всплывающих окон.', DEFAULT_DESKTOP_SETTINGS['appearance.menuRadius'], 0, 28, 1, 'px', 'global', 'advanced'),
  numberDefinition('appearance.modalRadius', 'appearance', 'Shape', 'Modal radius', 'Радиус модальных окон', 'Radius of command palette and dialogs.', 'Радиус палитры команд и диалогов.', DEFAULT_DESKTOP_SETTINGS['appearance.modalRadius'], 0, 32, 1, 'px', 'global', 'advanced'),
  numberDefinition('appearance.tabRadius', 'tabs', 'Tabs', 'Tab radius', 'Радиус вкладок', 'Radius of the active tab surface.', 'Радиус поверхности активной вкладки.', DEFAULT_DESKTOP_SETTINGS['appearance.tabRadius'], 0, 20, 1, 'px', 'global', 'advanced'),
  numberDefinition('appearance.pillRadius', 'appearance', 'Shape', 'Pill radius', 'Радиус компактных меток', 'Maximum radius used only by compact status chips.', 'Максимальный радиус только для компактных статусов.', DEFAULT_DESKTOP_SETTINGS['appearance.pillRadius'], 0, 999, 1, 'px', 'global', 'advanced'),
  numberDefinition('appearance.borderWidth', 'appearance', 'Borders', 'Border width', 'Толщина границ', 'Set structural and focus border width from 0 to 2px.', 'Задайте толщину структурных и границ фокуса от 0 до 2px.', DEFAULT_DESKTOP_SETTINGS['appearance.borderWidth'], 0, 2, 1, 'px', 'global', 'advanced'),
  numberDefinition('appearance.borderOpacity', 'appearance', 'Borders', 'Border opacity', 'Прозрачность границ', 'Control the opacity of structural dividers.', 'Настройте прозрачность структурных разделителей.', DEFAULT_DESKTOP_SETTINGS['appearance.borderOpacity'], 0, 1, 0.05, '', 'global', 'advanced'),
  booleanDefinition('appearance.dividers', 'appearance', 'Borders', 'Show dividers', 'Показывать разделители', 'Keep structural dividers visible in the shell.', 'Показывать структурные разделители оболочки.', DEFAULT_DESKTOP_SETTINGS['appearance.dividers']),
  enumDefinition('appearance.shadowPreset', 'appearance', 'Elevation', 'Shadow strength', 'Сила теней', 'Choose off, subtle, default, or strong elevation.', 'Выберите отсутствие, лёгкие, обычные или сильные тени.', DEFAULT_DESKTOP_SETTINGS['appearance.shadowPreset'], ['off', 'subtle', 'default', 'strong']),
  numberDefinition('appearance.shadowOpacity', 'appearance', 'Elevation', 'Shadow opacity', 'Прозрачность теней', 'Tune menu and dialog shadow opacity.', 'Настройте прозрачность теней меню и диалогов.', DEFAULT_DESKTOP_SETTINGS['appearance.shadowOpacity'], 0, 0.9, 0.05, '', 'global', 'advanced'),
  numberDefinition('appearance.shadowBlur', 'appearance', 'Elevation', 'Shadow blur', 'Размытие теней', 'Tune elevation blur without affecting content.', 'Настройте размытие теней без изменения контента.', DEFAULT_DESKTOP_SETTINGS['appearance.shadowBlur'], 0, 80, 2, 'px', 'global', 'advanced'),
  numberDefinition('appearance.transparency', 'appearance', 'Effects', 'Surface transparency', 'Прозрачность поверхностей', 'Blend surfaces gently with the app background.', 'Мягко смешивает поверхности с фоном приложения.', DEFAULT_DESKTOP_SETTINGS['appearance.transparency'], 0, 0.35, 0.05, '', 'global', 'advanced'),
  numberDefinition('appearance.blur', 'appearance', 'Effects', 'Blur intensity', 'Сила размытия', 'Use safe backdrop blur where the platform supports it.', 'Безопасное фоновое размытие при поддержке платформы.', DEFAULT_DESKTOP_SETTINGS['appearance.blur'], 0, 20, 1, 'px', 'global', 'advanced'),
  booleanDefinition('layout.activityBarVisible', 'layout', 'Activity Bar', 'Show Activity Bar', 'Показывать панель навигации', 'Show the primary navigation rail; it remains recoverable by Reset Layout.', 'Показывать основную навигацию; её можно вернуть через «Сбросить компоновку».', DEFAULT_DESKTOP_SETTINGS['layout.activityBarVisible']),
  enumDefinition('layout.activityBarPosition', 'layout', 'Activity Bar', 'Activity Bar position', 'Положение панели навигации', 'Place the rail on the leading or trailing side.', 'Разместить панель слева или справа.', DEFAULT_DESKTOP_SETTINGS['layout.activityBarPosition'], ['left', 'right']),
  numberDefinition('layout.activityBarWidth', 'layout', 'Activity Bar', 'Activity Bar width', 'Ширина панели навигации', 'Resize the navigation rail within functional limits.', 'Изменить ширину панели навигации в рабочих пределах.', DEFAULT_DESKTOP_SETTINGS['layout.activityBarWidth'], 52, 112, 2, 'px'),
  booleanDefinition('layout.sidebarVisible', 'layout', 'Sidebar', 'Show context sidebar', 'Показывать боковую панель контекста', 'Keep the object context sidebar available in the shell.', 'Оставлять боковую панель контекста доступной в оболочке.', DEFAULT_DESKTOP_SETTINGS['layout.sidebarVisible']),
  enumDefinition('layout.sidebarPosition', 'layout', 'Sidebar', 'Sidebar position', 'Положение боковой панели', 'Place the context sidebar on either side of the content.', 'Разместить боковую панель контекста слева или справа.', DEFAULT_DESKTOP_SETTINGS['layout.sidebarPosition'], ['left', 'right']),
  numberDefinition('layout.sidebarWidth', 'layout', 'Sidebar', 'Sidebar width', 'Ширина боковой панели', 'Resize the context sidebar from 180px to 520px.', 'Изменить ширину боковой панели от 180px до 520px.', DEFAULT_DESKTOP_SETTINGS['layout.sidebarWidth'], 180, 520, 4, 'px'),
  booleanDefinition('layout.inspectorVisible', 'layout', 'Inspector', 'Show inspector', 'Показывать инспектор', 'Show the optional inspector panel when a host provides one.', 'Показывать дополнительную панель инспектора при наличии среды.', DEFAULT_DESKTOP_SETTINGS['layout.inspectorVisible']),
  enumDefinition('layout.inspectorPosition', 'layout', 'Inspector', 'Inspector position', 'Положение инспектора', 'Choose the inspector side without changing content ownership.', 'Выберите сторону инспектора без изменения владения контентом.', DEFAULT_DESKTOP_SETTINGS['layout.inspectorPosition'], ['left', 'right']),
  numberDefinition('layout.inspectorWidth', 'layout', 'Inspector', 'Inspector width', 'Ширина инспектора', 'Reserve a safe width for the optional inspector panel.', 'Задайте рабочую ширину дополнительной панели инспектора.', DEFAULT_DESKTOP_SETTINGS['layout.inspectorWidth'], 220, 520, 4, 'px'),
  booleanDefinition('layout.omniboxVisible', 'layout', 'Toolbar', 'Show omnibox', 'Показывать поле поиска', 'Keep the local search and command field in the top bar.', 'Оставлять локальное поле поиска и команд в верхней панели.', DEFAULT_DESKTOP_SETTINGS['layout.omniboxVisible']),
  booleanDefinition('layout.breadcrumbsVisible', 'layout', 'Toolbar', 'Show breadcrumbs', 'Показывать иерархию', 'Show contextual object hierarchy when it exists.', 'Показывать иерархию объекта, когда она существует.', DEFAULT_DESKTOP_SETTINGS['layout.breadcrumbsVisible']),
  booleanDefinition('layout.workspaceSelectorVisible', 'layout', 'Toolbar', 'Show workspace selector', 'Показывать выбор рабочего пространства', 'Keep workspace switching available in the contextual toolbar.', 'Оставлять выбор рабочего пространства доступным в контекстной панели.', DEFAULT_DESKTOP_SETTINGS['layout.workspaceSelectorVisible']),
  booleanDefinition('layout.quickCaptureButtonVisible', 'layout', 'Toolbar', 'Show Quick Capture action', 'Показывать быстрый захват', 'Keep the transient Quick Capture action in the shell.', 'Оставлять быстрый захват доступным в оболочке.', DEFAULT_DESKTOP_SETTINGS['layout.quickCaptureButtonVisible']),
  booleanDefinition('layout.commandPaletteButtonVisible', 'layout', 'Toolbar', 'Show Command Palette action', 'Показывать палитру команд', 'Keep the command palette action in the top bar.', 'Оставлять палитру команд в верхней панели.', DEFAULT_DESKTOP_SETTINGS['layout.commandPaletteButtonVisible']),
  booleanDefinition('layout.newButtonVisible', 'layout', 'Toolbar', 'Show New action', 'Показывать «Создать»', 'Keep the real creation menu in the top bar.', 'Оставлять настоящее меню создания в верхней панели.', DEFAULT_DESKTOP_SETTINGS['layout.newButtonVisible']),
  booleanDefinition('layout.statusBarVisible', 'layout', 'Status Bar', 'Show status bar', 'Показывать строку состояния', 'Keep local save status visible in the footer.', 'Показывать локальный статус сохранения в нижней строке.', DEFAULT_DESKTOP_SETTINGS['layout.statusBarVisible']),
  numberDefinition('layout.toolbarHeight', 'layout', 'Toolbar', 'Toolbar height', 'Высота панели', 'Resize the top and contextual toolbar rows.', 'Изменить высоту верхней и контекстной панели.', DEFAULT_DESKTOP_SETTINGS['layout.toolbarHeight'], 30, 56, 1, 'px'),
  numberDefinition('layout.tabHeight', 'tabs', 'Tabs', 'Tab height', 'Высота вкладки', 'Resize tabs without changing their hit-area floor.', 'Изменить высоту вкладок, сохраняя минимальную область нажатия.', DEFAULT_DESKTOP_SETTINGS['layout.tabHeight'], 28, 48, 1, 'px'),
  numberDefinition('layout.statusBarHeight', 'layout', 'Status Bar', 'Status bar height', 'Высота строки состояния', 'Resize the footer status row.', 'Изменить высоту строки состояния внизу.', DEFAULT_DESKTOP_SETTINGS['layout.statusBarHeight'], 24, 42, 1, 'px'),
  numberDefinition('layout.contentMaxWidth', 'layout', 'Content', 'Content max width', 'Максимальная ширина контента', 'Set a readable maximum width for document surfaces.', 'Задайте читаемую максимальную ширину экранов с документами.', DEFAULT_DESKTOP_SETTINGS['layout.contentMaxWidth'], 720, 1600, 20, 'px', 'workspace', 'advanced'),
  stringDefinition('home.sectionOrder', 'home', 'Home sections', 'Home section order', 'Порядок секций главной', 'Persisted order of real Home sections.', 'Сохранённый порядок реальных секций главной.', DEFAULT_DESKTOP_SETTINGS['home.sectionOrder'], 'json', 'workspace', 'advanced'),
  stringDefinition('home.hiddenSections', 'home', 'Home sections', 'Hidden Home sections', 'Скрытые секции главной', 'Hide non-essential Home sections without deleting data.', 'Скрывает необязательные секции главной без удаления данных.', DEFAULT_DESKTOP_SETTINGS['home.hiddenSections'], 'json', 'workspace', 'advanced'),
  enumDefinition('home.density', 'home', 'Home sections', 'Home density', 'Плотность главной', 'Use compact or comfortable list rows on Home.', 'Компактные или комфортные строки главной.', DEFAULT_DESKTOP_SETTINGS['home.density'], ['comfortable', 'compact'], 'workspace'),
  enumDefinition('home.emptyPriority', 'home', 'Home sections', 'Empty Home priority', 'Приоритет пустой главной', 'Choose the first real action shown when Home has no content.', 'Выберите первое настоящее действие для пустой главной.', DEFAULT_DESKTOP_SETTINGS['home.emptyPriority'], ['quick-capture', 'new-document', 'tasks', 'search', 'ai', 'media'], 'workspace'),
  enumDefinition('tabs.style', 'tabs', 'Presentation', 'Tab style', 'Стиль вкладок', 'Connected, separated, or minimal tab presentation.', 'Связанные, разделённые или минимальные вкладки.', DEFAULT_DESKTOP_SETTINGS['tabs.style'], ['connected', 'separated', 'minimal']),
  booleanDefinition('tabs.showIcons', 'tabs', 'Presentation', 'Show tab icons', 'Показывать иконки вкладок', 'Show the semantic surface icon beside tab titles.', 'Показывать иконку поверхности рядом с названием.', DEFAULT_DESKTOP_SETTINGS['tabs.showIcons']),
  enumDefinition('tabs.closeButtons', 'tabs', 'Presentation', 'Close buttons', 'Кнопки закрытия', 'Show tab close controls always, on hover, or only on the active tab.', 'Показывать закрытие всегда, при наведении или только у активной вкладки.', DEFAULT_DESKTOP_SETTINGS['tabs.closeButtons'], ['always', 'hover', 'active']),
  booleanDefinition('tabs.middleClickClose', 'tabs', 'Behavior', 'Middle-click closes tabs', 'Закрытие средней кнопкой мыши', 'Allow middle-click to close a tab.', 'Разрешить закрытие вкладки средней кнопкой мыши.', DEFAULT_DESKTOP_SETTINGS['tabs.middleClickClose']),
  enumDefinition('tabs.doubleClickAction', 'tabs', 'Behavior', 'Double-click tab bar', 'Двойной клик по полосе вкладок', 'Choose no action, close, or create a new tab.', 'Выберите отсутствие действия, закрытие или новую вкладку.', DEFAULT_DESKTOP_SETTINGS['tabs.doubleClickAction'], ['none', 'close', 'new-tab']),
  enumDefinition('tabs.newTabPlacement', 'tabs', 'Behavior', 'New tab placement', 'Положение новой вкладки', 'Place explicit new tabs next to the current tab or at the end.', 'Открывать новые вкладки рядом с текущей или в конце.', DEFAULT_DESKTOP_SETTINGS['tabs.newTabPlacement'], ['end', 'next-to-current']),
  booleanDefinition('tabs.restoreTabs', 'tabs', 'Session', 'Restore tabs', 'Восстанавливать вкладки', 'Restore persisted tabs from the local owner session.', 'Восстанавливать сохранённые вкладки локальной сессии.', DEFAULT_DESKTOP_SETTINGS['tabs.restoreTabs']),
  booleanDefinition('tabs.recentlyUsedSwitching', 'tabs', 'Behavior', 'Recently used tab switching', 'Переключение по недавним вкладкам', 'Prefer recently used order for Ctrl/Cmd+Tab.', 'Использовать порядок недавних вкладок для Ctrl/Cmd+Tab.', DEFAULT_DESKTOP_SETTINGS['tabs.recentlyUsedSwitching']),
  booleanDefinition('tabs.tearOffEnabled', 'tabs', 'Behavior', 'Enable tab tear-off', 'Разрешить отделение вкладок', 'Allow a dragged tab to become a native Keystone window.', 'Разрешить превращать перетаскиваемую вкладку в системное окно.', DEFAULT_DESKTOP_SETTINGS['tabs.tearOffEnabled']),
  numberDefinition('tabs.detachThreshold', 'tabs', 'Behavior', 'Detach threshold', 'Порог отделения', 'Pointer distance required before a tab previews a new window.', 'Расстояние указателя до предпросмотра нового окна.', DEFAULT_DESKTOP_SETTINGS['tabs.detachThreshold'], 32, 96, 4, 'px', 'global', 'advanced'),
  numberDefinition('tabs.minWidth', 'tabs', 'Presentation', 'Minimum tab width', 'Минимальная ширина вкладки', 'Keep tab titles usable while allowing overflow.', 'Сохраняет читаемость названий при переполнении.', DEFAULT_DESKTOP_SETTINGS['tabs.minWidth'], 80, 160, 4, 'px', 'global', 'advanced'),
  numberDefinition('tabs.maxWidth', 'tabs', 'Presentation', 'Maximum tab width', 'Максимальная ширина вкладки', 'Bound long tab titles without hiding their full value from accessibility.', 'Ограничивает длинные названия без потери доступного значения.', DEFAULT_DESKTOP_SETTINGS['tabs.maxWidth'], 160, 360, 4, 'px', 'global', 'advanced'),
  booleanDefinition('tabs.preview', 'tabs', 'Presentation', 'Tab preview', 'Предпросмотр вкладок', 'Allow title and object metadata to appear on hover.', 'Показывать название и метаданные при наведении.', DEFAULT_DESKTOP_SETTINGS['tabs.preview']),
  enumDefinition('motion.mode', 'motion', 'Motion', 'Motion preference', 'Режим движения', 'Choose full, reduced, or off motion.', 'Выберите полное, уменьшенное или отключённое движение.', DEFAULT_DESKTOP_SETTINGS['motion.mode'], ['full', 'reduced', 'off']),
  numberDefinition('motion.speed', 'motion', 'Motion', 'Motion speed', 'Скорость движения', 'Scale safe transition durations from 50% to 150%.', 'Масштаб безопасной длительности переходов от 50% до 150%.', DEFAULT_DESKTOP_SETTINGS['motion.speed'], 0.5, 1.5, 0.1, '×', 'global', 'advanced'),
  enumDefinition('motion.easing', 'motion', 'Motion', 'Motion easing', 'Тип сглаживания', 'Use standard, smooth, or snappy transitions.', 'Выберите обычные, плавные или быстрые переходы.', DEFAULT_DESKTOP_SETTINGS['motion.easing'], ['standard', 'smooth', 'snappy'], 'global', 'advanced'),
  stringDefinition('shortcuts.commandPalette', 'shortcuts', 'Commands', 'Command Palette', 'Палитра команд', 'Open the canonical command registry.', 'Открывает основную палитру команд.', DEFAULT_DESKTOP_SETTINGS['shortcuts.commandPalette'], 'keybinding', 'global', 'basic'),
  stringDefinition('shortcuts.quit', 'shortcuts', 'Commands', 'Quit Keystone', 'Выйти из Keystone', 'Close Keystone through the canonical bounded shutdown path (Ctrl/Cmd+Q).', 'Закрыть Keystone через единый безопасный путь завершения (Ctrl/Cmd+Q).', DEFAULT_DESKTOP_SETTINGS['shortcuts.quit'], 'keybinding', 'global', 'basic'),
  stringDefinition('shortcuts.focusOmnibox', 'shortcuts', 'Commands', 'Focus omnibox', 'Фокус поля поиска', 'Focus local search and command input.', 'Фокусирует локальный поиск и поле команд.', DEFAULT_DESKTOP_SETTINGS['shortcuts.focusOmnibox'], 'keybinding', 'global', 'basic'),
  stringDefinition('shortcuts.quickCapture', 'shortcuts', 'Commands', 'Quick Capture', 'Быстрый захват', 'Open the transient local capture overlay.', 'Открывает компактное окно быстрого захвата.', DEFAULT_DESKTOP_SETTINGS['shortcuts.quickCapture'], 'keybinding', 'global', 'basic'),
  stringDefinition('shortcuts.closeTab', 'shortcuts', 'Tabs', 'Close tab', 'Закрыть вкладку', 'Close the active tab through the shell action.', 'Закрывает активную вкладку.', DEFAULT_DESKTOP_SETTINGS['shortcuts.closeTab'], 'keybinding', 'global', 'basic'),
  stringDefinition('shortcuts.newTab', 'shortcuts', 'Tabs', 'New tab', 'Новая вкладка', 'Open a new Home tab explicitly.', 'Открывает новую вкладку главной.', DEFAULT_DESKTOP_SETTINGS['shortcuts.newTab'], 'keybinding', 'global', 'basic'),
  stringDefinition('shortcuts.reopenTab', 'shortcuts', 'Tabs', 'Reopen tab', 'Открыть закрытую вкладку', 'Restore a tab from the bounded local closed-tab queue.', 'Восстанавливает вкладку из локальной очереди закрытых вкладок.', DEFAULT_DESKTOP_SETTINGS['shortcuts.reopenTab'], 'keybinding', 'global', 'basic'),
  stringDefinition('shortcuts.toggleSidebar', 'shortcuts', 'Layout', 'Toggle sidebar', 'Переключить боковую панель', 'Toggle the real context sidebar.', 'Переключает настоящую боковую панель контекста.', DEFAULT_DESKTOP_SETTINGS['shortcuts.toggleSidebar'], 'keybinding', 'global', 'basic'),
  stringDefinition('shortcuts.customize', 'shortcuts', 'Customization', 'Customize Keystone', 'Настроить Keystone', 'Open the owner customization environment.', 'Открывает среду настройки Keystone.', DEFAULT_DESKTOP_SETTINGS['shortcuts.customize'], 'keybinding', 'global', 'basic'),
  booleanDefinition('behavior.persistSortFilters', 'behavior', 'State', 'Persist sort and filters', 'Сохранять сортировку и фильтры', 'Persist supported surface view choices locally.', 'Сохранять поддержанные настройки представления локально.', DEFAULT_DESKTOP_SETTINGS['behavior.persistSortFilters']),
  booleanDefinition('behavior.closeSecondaryWithLastTab', 'behavior', 'Windows', 'Close secondary with last tab', 'Закрывать дополнительное окно с последней вкладкой', 'Close a secondary native window when its last tab is closed.', 'Закрывать дополнительное системное окно при закрытии последней вкладки.', DEFAULT_DESKTOP_SETTINGS['behavior.closeSecondaryWithLastTab']),
  booleanDefinition('behavior.openLinksInNewWindow', 'behavior', 'Windows', 'Open links in a new window', 'Открывать ссылки в новом окне', 'Use native windows for explicit external shell links where supported.', 'Открывать явные ссылки оболочки в системных окнах, если поддерживается.', DEFAULT_DESKTOP_SETTINGS['behavior.openLinksInNewWindow']),
  booleanDefinition('behavior.restoreWindows', 'behavior', 'Windows', 'Restore windows', 'Восстанавливать окна', 'Restore secondary native windows from the local registry.', 'Восстанавливать дополнительные системные окна из локального реестра.', DEFAULT_DESKTOP_SETTINGS['behavior.restoreWindows']),
  { id: 'security.allowRemoteScripts', category: 'security', subcategory: 'Immutable policy', label: { en: 'Allow remote scripts', ru: 'Разрешить удалённые скрипты' }, description: { en: 'Immutable policy: remote script execution is never enabled by owner preferences.', ru: 'Неизменяемая политика: выполнение удалённых скриптов никогда не включается настройками владельца.' }, type: 'boolean', default: false, scope: 'global', securityClass: 'IMMUTABLE_POLICY', restartRequirement: 'restart', searchKeywords: ['security', 'remote', 'scripts', 'immutable'], visibility: 'advanced' },
  booleanDefinition('advanced.customCssEnabled', 'advanced', 'Custom CSS', 'Enable custom CSS', 'Включить пользовательский CSS', 'Opt in to the local presentation-only stylesheet.', 'Явно включить локальную таблицу стилей только для оформления.', DEFAULT_DESKTOP_SETTINGS['advanced.customCssEnabled'], 'global', 'advanced'),
  stringDefinition('advanced.customCss', 'advanced', 'Custom CSS', 'Custom CSS', 'Пользовательский CSS', 'Local CSS only; JavaScript, imports, URLs and security changes are rejected.', 'Только локальный CSS; JavaScript, импорты, URL и изменения безопасности запрещены.', DEFAULT_DESKTOP_SETTINGS['advanced.customCss'], 'string', 'global', 'advanced'),
];

const DEFINITIONS = new Map<DesktopSettingId, DesktopSettingDefinition>(DESKTOP_SETTING_REGISTRY.map(definition => [definition.id, definition]));
const HOME_SECTIONS: readonly HomeSectionId[] = ['continue', 'today', 'recent', 'pinned'];
const KEYBINDING_PATTERN = /^(?:(?:Ctrl|Cmd|Alt|Shift|Meta)\+)*(?:[A-Z0-9]|Space|Tab|Escape|Enter|Backspace|Arrow(?:Up|Down|Left|Right)|F(?:[1-9]|1[0-2])|,|\\)$/i;

function canonicalShortcut(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '') : '';
}

export function findDesktopShortcutConflicts(values: DesktopSettingValueMap): readonly DesktopShortcutConflict[] {
  const byShortcut = new Map<string, DesktopSettingId[]>();
  for (const definition of DESKTOP_SETTING_REGISTRY) {
    if (definition.category !== 'shortcuts') continue;
    const shortcut = canonicalShortcut(values[definition.id]);
    if (!shortcut) continue;
    const ids = byShortcut.get(shortcut) ?? [];
    ids.push(definition.id);
    byShortcut.set(shortcut, ids);
  }
  return [...byShortcut.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([shortcut, ids]) => ({ shortcut, ids }));
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function isHexColor(value: unknown): value is string { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }
function asLayer(value: unknown): Partial<DesktopSettingValueMap> { return isRecord(value) ? value as Partial<DesktopSettingValueMap> : {}; }

function validColorOverrides(value: unknown): value is DesktopColorOverrides {
  if (!isRecord(value)) return false;
  return Object.values(value).every(item => isHexColor(item));
}

function validHomeSections(value: unknown): value is HomeSectionId[] {
  return Array.isArray(value) && value.length === HOME_SECTIONS.length && new Set(value).size === HOME_SECTIONS.length && value.every(item => HOME_SECTIONS.includes(item as HomeSectionId));
}

function normalizeHomeSectionOrder(value: unknown): HomeSectionId[] | undefined {
  if (validHomeSections(value)) return [...value];
  // Remove the pre-productization launcher section when an older profile is
  // opened.  It was presentation-only, so dropping it cannot affect data.
  if (!Array.isArray(value)) return undefined;
  const migrated = value.filter(item => item !== 'quick-actions');
  return validHomeSections(migrated) ? [...migrated] : undefined;
}

function normalizeValue(definition: DesktopSettingDefinition, value: unknown): unknown | undefined {
  if (definition.id === 'appearance.colors') return validColorOverrides(value) ? clone(value) : undefined;
  if (definition.id === 'home.sectionOrder') return normalizeHomeSectionOrder(value);
  if (definition.id === 'home.hiddenSections') return Array.isArray(value) && value.every(item => HOME_SECTIONS.includes(item as HomeSectionId)) ? [...new Set(value)] : undefined;
  if (definition.type === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (definition.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || definition.min === undefined || definition.max === undefined || value < definition.min || value > definition.max) return undefined;
    const step = definition.step ?? 1;
    const rounded = Math.round(value / step) * step;
    const precision = Math.max(0, (String(step).split('.')[1]?.length ?? 0) + 2);
    return Number(rounded.toFixed(precision));
  }
  if (definition.type === 'color') return isHexColor(value) ? value.toLowerCase() : undefined;
  if (definition.type === 'keybinding') return typeof value === 'string' && (!value || KEYBINDING_PATTERN.test(value)) ? value : undefined;
  if (definition.type === 'string') return typeof value === 'string' && value.length <= 256 ? value : undefined;
  if (definition.type === 'json') return value;
  if (definition.type === 'enum') return definition.allowedValues?.includes(value) ? value : undefined;
  return undefined;
}

function defaultDocument(): DesktopSettingsDocument {
  return { version: 2, global: {}, devices: {}, workspaces: {}, surfaces: {}, windows: {}, customCss: { enabled: false, css: '' } };
}

function sanitizeLayer(value: unknown): Partial<DesktopSettingValueMap> {
  const layer = asLayer(value);
  const safe: Partial<DesktopSettingValueMap> = {};
  for (const definition of DESKTOP_SETTING_REGISTRY) {
    if (definition.securityClass === 'IMMUTABLE_POLICY') continue;
    const candidate = normalizeValue(definition, layer[definition.id]);
    if (candidate !== undefined) (safe as Record<string, unknown>)[definition.id] = candidate;
  }
  return safe;
}

function sanitizeDocument(value: unknown): DesktopSettingsDocument {
  if (!isRecord(value) || value.version !== 2) return defaultDocument();
  const mapOfLayers = (candidate: unknown): Record<string, Partial<DesktopSettingValueMap>> => {
    if (!isRecord(candidate)) return {};
    return Object.fromEntries(Object.entries(candidate).filter(([key]) => key.length <= 160).map(([key, layer]) => [key, sanitizeLayer(layer)]));
  };
  const css = isRecord(value.customCss) ? value.customCss : {};
  const rawCss = typeof css.css === 'string' ? css.css.slice(0, 32768) : '';
  const safeCss = validateCustomCss(rawCss).ok ? rawCss : '';
  return {
    version: 2,
    global: sanitizeLayer(value.global),
    devices: mapOfLayers(value.devices),
    workspaces: mapOfLayers(value.workspaces),
    surfaces: mapOfLayers(value.surfaces),
    windows: mapOfLayers(value.windows),
    customCss: { enabled: css.enabled === true && Boolean(safeCss), css: safeCss },
  };
}

function migrateLegacy(storage: DesktopStorage): DesktopSettingsDocument {
  const document = defaultDocument();
  try {
    const raw = storage.getItem('keystone.desktop.preferences.v1');
    if (raw) {
      const legacy = JSON.parse(raw) as Record<string, unknown>;
      const mappings: Record<string, DesktopSettingId> = { theme: 'appearance.theme', accent: 'appearance.accent', customAccent: 'appearance.customAccent', density: 'appearance.density' };
      for (const [key, id] of Object.entries(mappings)) {
        const definition = DEFINITIONS.get(id);
        const normalized = definition ? normalizeValue(definition, legacy[key]) : undefined;
        if (normalized !== undefined) (document.global as Record<string, unknown>)[id] = normalized;
      }
      if (legacy.reducedMotion === true) document.global['motion.mode'] = 'reduced';
      if (legacy.visualEffects === false) { document.global['appearance.transparency'] = 0; document.global['appearance.blur'] = 0; document.global['appearance.shadowPreset'] = 'off'; }
    }
    if (storage.getItem('keystone.ui.reduced-motion') === '1') document.global['motion.mode'] = 'reduced';
  } catch {
    return defaultDocument();
  }
  return document;
}

function scopeLayer(document: DesktopSettingsDocument, scope: DesktopSettingScope, context: DesktopSettingsContext): Partial<DesktopSettingValueMap> | undefined {
  if (scope === 'global') return document.global;
  if (scope === 'device') return context.deviceId ? document.devices[context.deviceId] : undefined;
  if (scope === 'workspace') return context.workspaceId ? document.workspaces[context.workspaceId] : undefined;
  if (scope === 'surface') return context.surfaceId ? document.surfaces[`${context.workspaceId ?? 'global'}:${context.surfaceId}`] : undefined;
  if (scope === 'window') return context.windowId ? document.windows[context.windowId] : undefined;
  return undefined;
}

function setScopeLayer(document: DesktopSettingsDocument, scope: DesktopSettingScope, context: DesktopSettingsContext): Partial<DesktopSettingValueMap> | undefined {
  if (scope === 'global') return document.global;
  if (scope === 'device' && context.deviceId) return document.devices[context.deviceId] ?? (document.devices[context.deviceId] = {});
  if (scope === 'workspace' && context.workspaceId) return document.workspaces[context.workspaceId] ?? (document.workspaces[context.workspaceId] = {});
  if (scope === 'surface' && context.surfaceId) { const key = `${context.workspaceId ?? 'global'}:${context.surfaceId}`; return document.surfaces[key] ?? (document.surfaces[key] = {}); }
  if (scope === 'window' && context.windowId) return document.windows[context.windowId] ?? (document.windows[context.windowId] = {});
  return undefined;
}

function deleteEmptyLayers(document: DesktopSettingsDocument): void {
  for (const key of Object.keys(document.devices)) if (!Object.keys(document.devices[key]).length) delete document.devices[key];
  for (const key of Object.keys(document.workspaces)) if (!Object.keys(document.workspaces[key]).length) delete document.workspaces[key];
  for (const key of Object.keys(document.surfaces)) if (!Object.keys(document.surfaces[key]).length) delete document.surfaces[key];
  for (const key of Object.keys(document.windows)) if (!Object.keys(document.windows[key]).length) delete document.windows[key];
}

export function settingDefinition(id: DesktopSettingId): DesktopSettingDefinition {
  return DEFINITIONS.get(id)!;
}

export function settingsForCategory(category: DesktopSettingCategory, includeAdvanced = true): readonly DesktopSettingDefinition[] {
  return DESKTOP_SETTING_REGISTRY.filter(definition => definition.category === category && (includeAdvanced || definition.visibility !== 'advanced'));
}

export function validateSetting(id: DesktopSettingId, value: unknown): { readonly ok: boolean; readonly value?: unknown; readonly error?: string } {
  const definition = DEFINITIONS.get(id);
  if (!definition) return { ok: false, error: 'Unknown setting.' };
  const normalized = normalizeValue(definition, value);
  return normalized === undefined ? { ok: false, error: `Invalid value for ${id}.` } : { ok: true, value: normalized };
}

export function validateCustomCss(css: string): { readonly ok: boolean; readonly errors: readonly string[] } {
  const errors: string[] = [];
  if (typeof css !== 'string') errors.push('Custom CSS must be text.');
  if (css.length > 32768) errors.push('Custom CSS is limited to 32 KB.');
  if (/@import\b/i.test(css)) errors.push('Remote and local @import rules are not allowed.');
  if (/url\s*\(/i.test(css)) errors.push('url() assets are not allowed in custom CSS.');
  if (/<\s*script|javascript\s*:|expression\s*\(|behavior\s*:|-moz-binding/i.test(css)) errors.push('Executable CSS constructs are not allowed.');
  let balance = 0;
  let quote: '"' | "'" | undefined;
  for (const character of css) {
    if ((character === '"' || character === "'") && !quote) quote = character;
    else if (character === quote) quote = undefined;
    else if (!quote && character === '{') balance += 1;
    else if (!quote && character === '}') balance -= 1;
    if (balance < 0) break;
  }
  if (quote || balance !== 0) errors.push('Custom CSS has unbalanced quotes or braces.');
  return { ok: errors.length === 0, errors };
}

export function resolveDesktopTheme(theme: DesktopTheme, prefersDark: boolean): 'light' | 'dark' { return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme; }

export function desktopAccentValue(values: Pick<DesktopSettingValueMap, 'appearance.accent' | 'appearance.customAccent'>): string {
  const accent = values['appearance.accent'];
  if (accent === 'custom' && isHexColor(values['appearance.customAccent'])) return values['appearance.customAccent'];
  return DESKTOP_ACCENTS[accent === 'custom' ? 'rose' : accent].value;
}

export function desktopAccentForeground(accent: string): '#000000' | '#ffffff' {
  const linear = (offset: number) => {
    const channel = Number.parseInt(accent.slice(offset, offset + 2), 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  };
  const luminance = .2126 * linear(1) + .7152 * linear(3) + .0722 * linear(5);
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000000' : '#ffffff';
}


function radiusValues(values: DesktopSettingValueMap): { control: number; panel: number; menu: number; modal: number; tab: number; pill: number } {
  const preset = values['appearance.radiusPreset'];
  if (preset === 'square') return { control: 0, panel: 0, menu: 0, modal: 0, tab: 0, pill: 0 };
  if (preset === 'rounded') return { control: 12, panel: 16, menu: 14, modal: 18, tab: 10, pill: 999 };
  return { control: values['appearance.controlRadius'], panel: values['appearance.panelRadius'], menu: values['appearance.menuRadius'], modal: values['appearance.modalRadius'], tab: values['appearance.tabRadius'], pill: values['appearance.pillRadius'] };
}

function shadowValue(values: DesktopSettingValueMap): string {
  if (values['appearance.shadowPreset'] === 'off') return 'none';
  const multiplier = values['appearance.shadowPreset'] === 'subtle' ? 0.55 : values['appearance.shadowPreset'] === 'strong' ? 1.35 : 1;
  return `0 18px ${Math.round(values['appearance.shadowBlur'] * multiplier)}px rgba(0, 0, 0, ${Math.min(0.85, values['appearance.shadowOpacity'] * multiplier)})`;
}

/** Apply visual settings through semantic variables; no per-component React rerender is required. */
export function applyDesktopSettings(snapshot: DesktopSettingsSnapshot, prefersDark = false): void {
  if (typeof document === 'undefined') return;
  const values = snapshot.values;
  const root = document.documentElement;
  const theme = resolveDesktopTheme(values['appearance.theme'], prefersDark);
  const colors = { ...desktopThemeColors(theme), ...(values['appearance.colors'] ?? {}) };
  const accent = desktopAccentValue({ 'appearance.accent': values['appearance.accent'], 'appearance.customAccent': values['appearance.customAccent'] });
  const motionMode = values['motion.mode'] === 'full' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'reduced' : values['motion.mode'];
  const safeMode = typeof window !== 'undefined' && window.localStorage?.getItem('keystone.desktop.safe-ui-mode') === '1';
  const radii = radiusValues(values);
  const shadow = shadowValue(values);
  const uiScale = values['appearance.uiScale'];
  const scaled = (value: number): number => Math.round(value * uiScale);
  const set = (name: string, value: string | number) => root.style.setProperty(name, String(value));
  root.dataset.theme = theme;
  root.dataset.density = values['appearance.density'];
  root.dataset.reducedMotion = motionMode !== 'full' ? 'true' : 'false';
  root.dataset.motionMode = motionMode;
  root.dataset.visualEffects = values['appearance.blur'] > 0 || values['appearance.transparency'] > 0 ? 'true' : 'false';
  root.dataset.activityBarPosition = values['layout.activityBarPosition'];
  root.dataset.activityBarVisible = values['layout.activityBarVisible'] ? 'true' : 'false';
  root.dataset.sidebarPosition = values['layout.sidebarPosition'];
  root.dataset.sidebarVisible = values['layout.sidebarVisible'] ? 'true' : 'false';
  root.dataset.inspectorPosition = values['layout.inspectorPosition'];
  root.dataset.inspectorVisible = values['layout.inspectorVisible'] ? 'true' : 'false';
  root.dataset.tabStyle = values['tabs.style'];
  root.dataset.tabCloseButtons = values['tabs.closeButtons'];
  root.dataset.tabIcons = values['tabs.showIcons'] ? 'true' : 'false';
  root.dataset.dividers = values['appearance.dividers'] ? 'true' : 'false';
  root.dataset.statusBarVisible = values['layout.statusBarVisible'] ? 'true' : 'false';
  root.dataset.customCss = snapshot.document.customCss.enabled ? 'enabled' : 'disabled';
  root.dataset.safeUiMode = safeMode ? 'true' : 'false';
  root.style.colorScheme = theme;
  set('--ks-ui-scale', values['appearance.uiScale']);
  set('--ks-space-unit', values['appearance.density'] === 'compact' ? 3 : 4);
  set('--ks-base-font-size', `${values['appearance.baseFontSize']}px`);
  set('--ks-heading-scale', values['appearance.headingScale']);
  set('--ks-line-height', values['appearance.lineHeight']);
  set('--ks-letter-spacing', `${values['appearance.letterSpacing']}em`);
  set('--ks-font-monospace', values['appearance.monospaceFont']);
  set('--ks-activity-bar-width', `${scaled(values['layout.activityBarWidth'])}px`);
  set('--ks-sidebar-width', `${scaled(values['layout.sidebarWidth'])}px`);
  set('--ks-inspector-width', `${scaled(values['layout.inspectorWidth'])}px`);
  set('--ks-toolbar-height', `${scaled(values['layout.toolbarHeight'])}px`);
  set('--ks-tab-height', `${scaled(values['layout.tabHeight'])}px`);
  set('--ks-tab-min-width', `${scaled(values['tabs.minWidth'])}px`);
  set('--ks-tab-max-width', `${scaled(values['tabs.maxWidth'])}px`);
  set('--ks-status-bar-height', `${scaled(values['layout.statusBarHeight'])}px`);
  set('--ks-content-max-width', `${scaled(values['layout.contentMaxWidth'])}px`);
  set('--ks-radius-control', `${radii.control}px`);
  set('--ks-radius-panel', `${radii.panel}px`);
  set('--ks-radius-menu', `${radii.menu}px`);
  set('--ks-radius-modal', `${radii.modal}px`);
  set('--ks-radius-tab', `${radii.tab}px`);
  set('--ks-radius-pill', `${radii.pill}px`);
  set('--ks-border-width', `${values['appearance.borderWidth']}px`);
  set('--ks-border-opacity', values['appearance.borderOpacity']);
  set('--ks-shadow', shadow);
  set('--ks-shadow-opacity', values['appearance.shadowOpacity']);
  set('--ks-blur', `${values['appearance.blur']}px`);
  set('--ks-surface-alpha', 1 - values['appearance.transparency']);
  set('--ks-motion-speed', values['motion.speed']);
  set('--ks-motion-duration', `${Math.max(1, Math.round(170 * values['motion.speed']))}ms`);
  const easing = values['motion.easing'] === 'smooth' ? 'cubic-bezier(.2, 0, 0, 1)' : values['motion.easing'] === 'snappy' ? 'cubic-bezier(.4, 0, .2, 1)' : 'cubic-bezier(.2, 0, 0, 1)';
  set('--ks-motion-easing', easing);
  const tokenMap: Record<string, string> = {
    '--ks-bg-app': colors.background ?? DEFAULT_COLORS.background!, '--ks-bg-window': colors.background ?? DEFAULT_COLORS.background!, '--ks-bg-content': colors.background ?? DEFAULT_COLORS.background!, '--ks-bg-sidebar': colors.sidebar ?? DEFAULT_COLORS.sidebar!, '--ks-bg-toolbar': colors.toolbar ?? DEFAULT_COLORS.toolbar!, '--ks-bg-tabbar': colors.tabbar ?? DEFAULT_COLORS.tabbar!, '--ks-bg-panel': colors.surface ?? DEFAULT_COLORS.surface!, '--ks-bg-elevated': colors.surfaceElevated ?? DEFAULT_COLORS.surfaceElevated!, '--ks-bg-overlay': colors.surfaceElevated ?? DEFAULT_COLORS.surfaceElevated!, '--ks-bg-menu': colors.surfaceElevated ?? DEFAULT_COLORS.surfaceElevated!, '--ks-bg-tooltip': colors.surfaceElevated ?? DEFAULT_COLORS.surfaceElevated!, '--ks-bg-input': colors.background ?? DEFAULT_COLORS.background!, '--ks-text-primary': colors.primaryText ?? DEFAULT_COLORS.primaryText!, '--ks-text-secondary': colors.secondaryText ?? DEFAULT_COLORS.secondaryText!, '--ks-text-tertiary': colors.secondaryText ?? DEFAULT_COLORS.secondaryText!, '--ks-text-muted': colors.secondaryText ?? DEFAULT_COLORS.secondaryText!, '--ks-text-disabled': colors.secondaryText ?? DEFAULT_COLORS.secondaryText!, '--ks-text-accent': accent, '--ks-text-danger': colors.danger ?? DEFAULT_COLORS.danger!, '--ks-text-warning': colors.warning ?? DEFAULT_COLORS.warning!, '--ks-text-success': colors.success ?? DEFAULT_COLORS.success!, '--ks-text-info': accent, '--ks-border-subtle': colors.border ?? DEFAULT_COLORS.border!, '--ks-border-normal': colors.border ?? DEFAULT_COLORS.border!, '--ks-border-strong': colors.border ?? DEFAULT_COLORS.border!, '--ks-border-focus': colors.focus ?? accent, '--ks-border-selected': accent, '--ks-accent-primary': accent, '--ks-accent-hover': accent, '--ks-accent-pressed': accent, '--ks-accent-subtle': `${accent}24`, '--ks-accent-foreground': desktopAccentForeground(accent), '--ks-state-hover': colors.surfaceElevated ?? DEFAULT_COLORS.surfaceElevated!, '--ks-state-active': colors.surfaceElevated ?? DEFAULT_COLORS.surfaceElevated!, '--ks-state-selected': `${accent}20`, '--ks-state-focus': `${accent}25`, '--ks-state-attention': colors.warning ?? DEFAULT_COLORS.warning!, '--ks-state-unread': accent, '--ks-state-disabled': colors.secondaryText ?? DEFAULT_COLORS.secondaryText!,
    '--shell-bg': colors.background ?? DEFAULT_COLORS.background!, '--shell-surface': colors.surface ?? DEFAULT_COLORS.surface!, '--shell-raised': colors.surfaceElevated ?? DEFAULT_COLORS.surfaceElevated!, '--shell-hover': colors.surfaceElevated ?? DEFAULT_COLORS.surfaceElevated!, '--shell-border': colors.border ?? DEFAULT_COLORS.border!, '--shell-border-strong': colors.border ?? DEFAULT_COLORS.border!, '--shell-text': colors.primaryText ?? DEFAULT_COLORS.primaryText!, '--shell-muted': colors.secondaryText ?? DEFAULT_COLORS.secondaryText!, '--shell-subtle': colors.secondaryText ?? DEFAULT_COLORS.secondaryText!, '--shell-accent': accent, '--shell-accent-deep': accent, '--shell-accent-soft': `${accent}24`, '--shell-green': colors.success ?? DEFAULT_COLORS.success!, '--shell-yellow': colors.warning ?? DEFAULT_COLORS.warning!,
  };
  for (const [name, value] of Object.entries(tokenMap)) set(name, value);
  applyCustomCss(safeMode ? { enabled: false, css: '' } : snapshot.document.customCss);
}

function applyCustomCss(customCss: DesktopSettingsDocument['customCss']): void {
  if (typeof document === 'undefined') return;
  const styleId = 'keystone-owner-custom-css';
  document.getElementById(styleId)?.remove();
  if (!customCss.enabled || !customCss.css) return;
  const validation = validateCustomCss(customCss.css);
  if (!validation.ok) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.dataset.keystoneOwnerCss = 'true';
  style.textContent = customCss.css;
  document.head.appendChild(style);
}

export class DesktopSettingsStore {
  private document: DesktopSettingsDocument;
  private readonly storage: DesktopStorage;
  private readonly listeners = new Set<() => void>();
  private undoStack: DesktopSettingsDocument[] = [];
  private redoStack: DesktopSettingsDocument[] = [];

  constructor(storage: DesktopStorage = defaultStorage()) {
    this.storage = storage;
    this.document = this.read();
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  snapshot(): DesktopSettingsDocument { return clone(this.document); }
  reload(): void { this.document = this.read(); this.emit(); }
  effective(context: DesktopSettingsContext = {}): DesktopSettingsSnapshot {
    const values = clone(DEFAULT_DESKTOP_SETTINGS);
    const sources = Object.fromEntries(DESKTOP_SETTING_REGISTRY.map(definition => [definition.id, 'default'])) as Record<DesktopSettingId, DesktopSettingScope | 'default'>;
    const layers: Array<{ scope: DesktopSettingScope; values: Partial<DesktopSettingValueMap> | undefined }> = [
      { scope: 'global', values: this.document.global },
      { scope: 'device', values: scopeLayer(this.document, 'device', context) },
      { scope: 'workspace', values: scopeLayer(this.document, 'workspace', context) },
      { scope: 'surface', values: scopeLayer(this.document, 'surface', context) },
      { scope: 'window', values: scopeLayer(this.document, 'window', context) },
    ];
    for (const layer of layers) for (const definition of DESKTOP_SETTING_REGISTRY) {
      const value = layer.values?.[definition.id];
      if (value !== undefined) { (values as unknown as Record<string, unknown>)[definition.id] = clone(value); sources[definition.id] = layer.scope; }
    }
    if (context.deviceId && this.document.devices[context.deviceId]) { /* source resolution above is intentionally explicit */ }
    return { values, sources, document: this.snapshot(), context: { ...context } };
  }

  get<K extends DesktopSettingId>(id: K, context: DesktopSettingsContext = {}): DesktopSettingValueMap[K] { return this.effective(context).values[id] as DesktopSettingValueMap[K]; }

  set(id: DesktopSettingId, value: unknown, scope: DesktopSettingScope = settingDefinition(id).scope, context: DesktopSettingsContext = {}): DesktopSettingMutation {
    if (settingDefinition(id).securityClass === 'IMMUTABLE_POLICY') return { ok: false, error: 'This security policy is immutable.' };
    const validated = validateSetting(id, value);
    if (!validated.ok) return validated;
    if (scope === 'session') return { ok: false, error: 'Session settings are not persisted by this store.' };
    const next = clone(this.document);
    const layer = setScopeLayer(next, scope, context);
    if (!layer) return { ok: false, error: `A ${scope} context is required for ${id}.` };
    (layer as Record<string, unknown>)[id] = clone(validated.value);
    if (id === 'advanced.customCss') {
      const css = String(validated.value ?? '');
      const cssValidation = validateCustomCss(css);
      if (!cssValidation.ok) return { ok: false, error: cssValidation.errors.join(' ') };
      next.customCss = { enabled: next.customCss.enabled, css };
    }
    if (id === 'advanced.customCssEnabled') next.customCss = { enabled: validated.value === true && Boolean(next.customCss.css), css: next.customCss.css };
    return this.commit(next);
  }

  reset(id: DesktopSettingId, scope: DesktopSettingScope = settingDefinition(id).scope, context: DesktopSettingsContext = {}): DesktopSettingMutation {
    const next = clone(this.document);
    const layer = scopeLayer(next, scope, context);
    if (!layer) return { ok: false, error: `A ${scope} context is required for ${id}.` };
    delete (layer as Record<string, unknown>)[id];
    if (id === 'advanced.customCss') next.customCss = { enabled: false, css: '' };
    if (id === 'advanced.customCssEnabled') next.customCss = { ...next.customCss, enabled: false };
    deleteEmptyLayers(next);
    return this.commit(next);
  }

  resetSection(category: DesktopSettingCategory, scope: DesktopSettingScope = 'global', context: DesktopSettingsContext = {}): DesktopSettingMutation {
    const next = clone(this.document);
    const layer = scopeLayer(next, scope, context);
    if (!layer) return { ok: false, error: `A ${scope} context is required.` };
    for (const definition of DESKTOP_SETTING_REGISTRY) if (definition.category === category) delete (layer as Record<string, unknown>)[definition.id];
    if (category === 'advanced') next.customCss = { enabled: false, css: '' };
    deleteEmptyLayers(next);
    return this.commit(next);
  }

  resetAllAppearance(context: DesktopSettingsContext = {}): DesktopSettingMutation {
    const next = clone(this.document);
    const layers: Partial<DesktopSettingValueMap>[] = [next.global, ...Object.values(next.devices), ...Object.values(next.workspaces), ...Object.values(next.surfaces), ...Object.values(next.windows)];
    for (const layer of layers) for (const definition of DESKTOP_SETTING_REGISTRY) if (definition.category === 'appearance' || definition.category === 'motion') delete (layer as Record<string, unknown>)[definition.id];
    deleteEmptyLayers(next);
    return this.commit(next);
  }

  resetLayout(context: DesktopSettingsContext = {}): DesktopSettingMutation {
    const next = clone(this.document);
    const layers: Partial<DesktopSettingValueMap>[] = [next.global, ...Object.values(next.devices), ...Object.values(next.workspaces), ...Object.values(next.surfaces), ...Object.values(next.windows)];
    for (const layer of layers) for (const definition of DESKTOP_SETTING_REGISTRY) if (definition.category === 'layout' || definition.category === 'home' || definition.category === 'tabs') delete (layer as Record<string, unknown>)[definition.id];
    deleteEmptyLayers(next);
    return this.commit(next);
  }

  /**
   * Recovery migration for profiles written by the pre-recovery shell.  Only
   * session-topology preferences are removed; appearance, privacy and all
   * owner data remain untouched.  An explicit future opt-in can use the
   * versioned policy helper above.
   */
  disableAutomaticSessionRestore(): DesktopSettingMutation {
    const next = clone(this.document);
    const layers: Partial<DesktopSettingValueMap>[] = [next.global, ...Object.values(next.devices), ...Object.values(next.workspaces), ...Object.values(next.surfaces), ...Object.values(next.windows)];
    for (const layer of layers) {
      delete (layer as Record<string, unknown>)['tabs.restoreTabs'];
      delete (layer as Record<string, unknown>)['behavior.restoreWindows'];
    }
    deleteEmptyLayers(next);
    const result = this.commit(next);
    if (result.ok) setDesktopSessionRestoreEnabled(this.storage, false);
    return result;
  }

  resetShortcuts(): DesktopSettingMutation {
    const next = clone(this.document);
    for (const definition of DESKTOP_SETTING_REGISTRY) if (definition.category === 'shortcuts') delete (next.global as Record<string, unknown>)[definition.id];
    return this.commit(next);
  }

  restore(document: DesktopSettingsDocument): DesktopSettingMutation { return this.commit(sanitizeDocument(document)); }

  applyPreset(preset: DesktopPresetId, scope: DesktopSettingScope = 'global', context: DesktopSettingsContext = {}): DesktopSettingMutation {
    const next = clone(this.document);
    const layer = setScopeLayer(next, scope, context);
    if (!layer) return { ok: false, error: `A ${scope} context is required.` };
    if (preset === 'keystone-default') {
      for (const definition of DESKTOP_SETTING_REGISTRY) if (definition.category === 'appearance' || definition.category === 'layout' || definition.category === 'home' || definition.category === 'tabs' || definition.category === 'motion') delete (layer as Record<string, unknown>)[definition.id];
    } else for (const [id, value] of Object.entries(DESKTOP_PRESETS[preset])) (layer as Record<string, unknown>)[id] = clone(value);
    deleteEmptyLayers(next);
    return this.commit(next);
  }

  undo(): boolean { const previous = this.undoStack.pop(); if (!previous) return false; this.redoStack.push(clone(this.document)); this.document = clone(previous); this.write(this.document); this.emit(); return true; }
  redo(): boolean { const next = this.redoStack.pop(); if (!next) return false; this.undoStack.push(clone(this.document)); this.document = clone(next); this.write(this.document); this.emit(); return true; }

  exportSafe(): string {
    const filterLayer = (layer: Partial<DesktopSettingValueMap>): Partial<DesktopSettingValueMap> => {
      const safe: Partial<DesktopSettingValueMap> = {};
      for (const definition of DESKTOP_SETTING_REGISTRY) if (definition.securityClass === 'USER_PREFERENCE' || definition.securityClass === 'PRIVACY_SETTING') {
        if (layer[definition.id] !== undefined) (safe as Record<string, unknown>)[definition.id] = clone(layer[definition.id]);
      }
      return safe;
    };
    const value = { schema: 'keystone-settings', version: 2, exportedAt: new Date().toISOString(), global: filterLayer(this.document.global), devices: Object.fromEntries(Object.entries(this.document.devices).map(([key, layer]) => [key, filterLayer(layer)])), workspaces: Object.fromEntries(Object.entries(this.document.workspaces).map(([key, layer]) => [key, filterLayer(layer)])), surfaces: Object.fromEntries(Object.entries(this.document.surfaces).map(([key, layer]) => [key, filterLayer(layer)])), windows: Object.fromEntries(Object.entries(this.document.windows).map(([key, layer]) => [key, filterLayer(layer)])), customCss: this.document.customCss };
    return JSON.stringify(value, null, 2);
  }

  previewImport(input: unknown): DesktopSettingsImportPreview {
    let parsed: unknown = input;
    if (typeof input === 'string') { try { parsed = JSON.parse(input); } catch { return { ok: false, changes: [], conflicts: [], errors: ['The settings file is not valid JSON.'] }; } }
    if (!isRecord(parsed) || (parsed.schema !== 'keystone-settings' && parsed.version !== 2)) return { ok: false, changes: [], conflicts: [], errors: ['Unsupported Keystone settings schema.'] };
    const changes: Array<{ id: DesktopSettingId; value: unknown; scope: DesktopSettingScope }> = [];
    const errors: string[] = [];
    const visit = (scope: DesktopSettingScope, layer: unknown) => {
      if (!isRecord(layer)) return;
      for (const [id, value] of Object.entries(layer)) {
        if (!DEFINITIONS.has(id as DesktopSettingId)) { errors.push(`Unknown setting ${id}.`); continue; }
        const validated = validateSetting(id as DesktopSettingId, value);
        if (!validated.ok) errors.push(validated.error ?? `Invalid setting ${id}.`);
        else changes.push({ id: id as DesktopSettingId, value: validated.value, scope });
      }
    };
    visit('global', parsed.global);
    if (isRecord(parsed.devices)) for (const layer of Object.values(parsed.devices)) visit('device', layer);
    if (isRecord(parsed.workspaces)) for (const layer of Object.values(parsed.workspaces)) visit('workspace', layer);
    if (isRecord(parsed.surfaces)) for (const layer of Object.values(parsed.surfaces)) visit('surface', layer);
    if (isRecord(parsed.windows)) for (const layer of Object.values(parsed.windows)) visit('window', layer);
    if (isRecord(parsed.customCss) && typeof parsed.customCss.css === 'string') { const result = validateCustomCss(parsed.customCss.css); if (!result.ok) errors.push(...result.errors); }
    return { ok: errors.length === 0, version: typeof parsed.version === 'number' ? parsed.version : 2, changes, conflicts: [], errors };
  }

  importSafe(input: unknown, mode: 'merge' | 'replace' = 'merge'): DesktopSettingsImportPreview {
    const preview = this.previewImport(input);
    if (!preview.ok) return preview;
    let parsed: unknown = input;
    if (typeof input === 'string') parsed = JSON.parse(input) as unknown;
    if (!isRecord(parsed)) return preview;
    const next = mode === 'replace' ? defaultDocument() : clone(this.document);
    const importLayer = (scope: DesktopSettingScope, layer: unknown, key?: string) => {
      if (!isRecord(layer)) return;
      const target = scope === 'global' ? next.global : scope === 'device' ? (next.devices[key ?? 'imported-device'] ?? (next.devices[key ?? 'imported-device'] = {})) : scope === 'workspace' ? (next.workspaces[key ?? 'imported-workspace'] ?? (next.workspaces[key ?? 'imported-workspace'] = {})) : scope === 'surface' ? (next.surfaces[key ?? 'imported-surface'] ?? (next.surfaces[key ?? 'imported-surface'] = {})) : (next.windows[key ?? 'imported-window'] ?? (next.windows[key ?? 'imported-window'] = {}));
      for (const [id, value] of Object.entries(layer)) { const validated = validateSetting(id as DesktopSettingId, value); if (validated.ok) (target as Record<string, unknown>)[id] = clone(validated.value); }
    };
    importLayer('global', parsed.global);
    if (isRecord(parsed.devices)) for (const [key, layer] of Object.entries(parsed.devices)) importLayer('device', layer, key);
    if (isRecord(parsed.workspaces)) for (const [key, layer] of Object.entries(parsed.workspaces)) importLayer('workspace', layer, key);
    if (isRecord(parsed.surfaces)) for (const [key, layer] of Object.entries(parsed.surfaces)) importLayer('surface', layer, key);
    if (isRecord(parsed.windows)) for (const [key, layer] of Object.entries(parsed.windows)) importLayer('window', layer, key);
    if (isRecord(parsed.customCss) && typeof parsed.customCss.css === 'string') next.customCss = { enabled: parsed.customCss.enabled === true, css: parsed.customCss.css.slice(0, 32768) };
    return this.commit(next).ok ? preview : { ...preview, ok: false, errors: ['Could not persist imported settings.'] };
  }

  setCustomCss(css: string, enabled: boolean): DesktopSettingMutation {
    const validation = validateCustomCss(css);
    if (!validation.ok) return { ok: false, error: validation.errors.join(' ') };
    const next = clone(this.document);
    next.customCss = { enabled: enabled && Boolean(css), css };
    next.global['advanced.customCss'] = css;
    next.global['advanced.customCssEnabled'] = enabled && Boolean(css);
    return this.commit(next);
  }

  private read(): DesktopSettingsDocument {
    try {
      const raw = this.storage.getItem(DESKTOP_SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const safe = sanitizeDocument(parsed);
        // Persist migrations (including removal of presentation-only legacy
        // Home sections) so an older profile is upgraded once, not on every
        // shell restart.
        if (JSON.stringify(parsed) !== JSON.stringify(safe)) this.write(safe);
        return safe;
      }
      const migrated = migrateLegacy(this.storage);
      this.write(migrated);
      return migrated;
    } catch { return defaultDocument(); }
  }

  private commit(next: DesktopSettingsDocument): DesktopSettingMutation {
    const safe = sanitizeDocument(next);
    try {
      this.write(safe);
      setDesktopSessionRestoreEnabled(this.storage, safe.global['tabs.restoreTabs'] === true && safe.global['behavior.restoreWindows'] === true);
      this.undoStack.push(clone(this.document));
      if (this.undoStack.length > 50) this.undoStack.shift();
      this.redoStack = [];
      this.document = safe;
      this.emit();
      return { ok: true, value: safe };
    } catch { return { ok: false, error: 'Could not persist this setting.' }; }
  }

  private write(document: DesktopSettingsDocument): void { this.storage.setItem(DESKTOP_SETTINGS_KEY, JSON.stringify(document)); }
  private emit(): void { for (const listener of this.listeners) listener(); }
}

export function createDesktopSettingsSnapshot(storage: DesktopStorage = defaultStorage(), context: DesktopSettingsContext = {}): DesktopSettingsSnapshot { return new DesktopSettingsStore(storage).effective(context); }
