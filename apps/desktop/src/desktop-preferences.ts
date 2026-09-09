import { defaultStorage, type DesktopStorage } from './desktop-shell-model';
import {
  applyDesktopSettings,
  createDesktopSettingsSnapshot,
  DESKTOP_ACCENTS,
  DesktopSettingsStore,
  type DesktopSettingsContext,
  type DesktopTheme,
  type DesktopAccent,
  type DesktopDensity,
} from './desktop-settings';

/** Compatibility facade for onboarding and older desktop callers. */
export type { DesktopTheme, DesktopAccent, DesktopDensity } from './desktop-settings';
export { DESKTOP_ACCENTS } from './desktop-settings';
export { resolveDesktopTheme } from './desktop-settings';

export type DesktopSidebarSize = 'narrow' | 'default' | 'wide';

export interface DesktopPreferences {
  readonly version: 1;
  readonly theme: DesktopTheme;
  readonly accent: DesktopAccent;
  readonly customAccent?: string;
  readonly density: DesktopDensity;
  readonly sidebarSize: DesktopSidebarSize;
  readonly reducedMotion: boolean;
  readonly visualEffects: boolean;
}

export const DESKTOP_PREFERENCES_KEY = 'keystone.desktop.preferences.v1';

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  version: 1,
  theme: 'system',
  accent: 'rose',
  density: 'comfortable',
  sidebarSize: 'default',
  reducedMotion: false,
  visualEffects: true,
};

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function isHexColor(value: unknown): value is string { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }

function parseLegacy(value: unknown): DesktopPreferences {
  if (!isRecord(value)) return { ...DEFAULT_DESKTOP_PREFERENCES };
  const theme = value.theme === 'system' || value.theme === 'light' || value.theme === 'dark' ? value.theme : DEFAULT_DESKTOP_PREFERENCES.theme;
  const accent = value.accent === 'rose' || value.accent === 'blue' || value.accent === 'violet' || value.accent === 'amber' || value.accent === 'green' || value.accent === 'custom' ? value.accent : DEFAULT_DESKTOP_PREFERENCES.accent;
  const customAccent = isHexColor(value.customAccent) ? value.customAccent.toLowerCase() : undefined;
  return {
    version: 1,
    theme,
    accent,
    ...(customAccent ? { customAccent } : {}),
    density: value.density === 'compact' ? 'compact' : 'comfortable',
    sidebarSize: value.sidebarSize === 'narrow' || value.sidebarSize === 'wide' ? value.sidebarSize : 'default',
    reducedMotion: value.reducedMotion === true,
    visualEffects: value.visualEffects !== false,
  };
}

function fromSettings(context: DesktopSettingsContext, storage: DesktopStorage): DesktopPreferences {
  const values = new DesktopSettingsStore(storage).effective(context).values;
  const sidebarWidth = values['layout.sidebarWidth'];
  const sidebarSize: DesktopSidebarSize = sidebarWidth < 240 ? 'narrow' : sidebarWidth > 330 ? 'wide' : 'default';
  const customAccent = values['appearance.customAccent'];
  return {
    version: 1,
    theme: values['appearance.theme'],
    accent: values['appearance.accent'],
    ...(values['appearance.accent'] === 'custom' && isHexColor(customAccent) ? { customAccent } : {}),
    density: values['appearance.density'],
    sidebarSize,
    reducedMotion: values['motion.mode'] !== 'full',
    visualEffects: values['appearance.blur'] > 0 || values['appearance.transparency'] > 0 || values['appearance.shadowPreset'] !== 'off',
  };
}

export function readDesktopPreferences(storage: DesktopStorage = defaultStorage(), context: DesktopSettingsContext = {}): DesktopPreferences {
  try {
    if (storage.getItem('keystone.desktop.settings.v2')) return fromSettings(context, storage);
    const raw = storage.getItem(DESKTOP_PREFERENCES_KEY);
    if (raw) return parseLegacy(JSON.parse(raw));
    return { ...DEFAULT_DESKTOP_PREFERENCES, reducedMotion: storage.getItem('keystone.ui.reduced-motion') === '1' };
  } catch {
    return { ...DEFAULT_DESKTOP_PREFERENCES };
  }
}

function toSettingValues(preferences: DesktopPreferences): Record<string, unknown> {
  const sidebarWidth = preferences.sidebarSize === 'narrow' ? 212 : preferences.sidebarSize === 'wide' ? 380 : 280;
  return {
    'appearance.theme': preferences.theme,
    'appearance.accent': preferences.accent,
    'appearance.customAccent': preferences.customAccent ?? '#e9254d',
    'appearance.density': preferences.density,
    'layout.sidebarWidth': sidebarWidth,
    'motion.mode': preferences.reducedMotion ? 'reduced' : 'full',
    'appearance.shadowPreset': preferences.visualEffects ? 'default' : 'off',
    'appearance.blur': 0,
    'appearance.transparency': 0,
  };
}

export function writeDesktopPreferences(preferences: DesktopPreferences, storage: DesktopStorage = defaultStorage()): DesktopPreferences {
  const safe = parseLegacy(preferences);
  const store = new DesktopSettingsStore(storage);
  for (const [id, value] of Object.entries(toSettingValues(safe))) store.set(id as never, value, 'global');
  try { storage.setItem(DESKTOP_PREFERENCES_KEY, JSON.stringify(safe)); } catch { /* storage is optional */ }
  return safe;
}

export function updateDesktopPreferences(patch: Partial<DesktopPreferences>, storage: DesktopStorage = defaultStorage()): DesktopPreferences {
  return writeDesktopPreferences({ ...readDesktopPreferences(storage), ...patch, version: 1 }, storage);
}

export function desktopAccentValue(preferences: Pick<DesktopPreferences, 'accent' | 'customAccent'>): string {
  if (preferences.accent === 'custom' && isHexColor(preferences.customAccent)) return preferences.customAccent;
  return DESKTOP_ACCENTS[preferences.accent === 'custom' ? 'rose' : preferences.accent].value;
}

/** Apply the compatibility shape through the canonical semantic token layer. */
export function applyDesktopPreferences(preferences: DesktopPreferences, prefersDark = false): void {
  const snapshot = createDesktopSettingsSnapshot();
  const values = { ...snapshot.values, ...toSettingValues(preferences) } as typeof snapshot.values;
  applyDesktopSettings({ ...snapshot, values }, prefersDark);
}
