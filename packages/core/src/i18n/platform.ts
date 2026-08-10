import { createI18nManager, type I18nManager, type LocaleDetector } from './index';

/** Desktop detector: the Tauri command reads the OS locale, with a browser fallback. */
export function createDesktopI18nManager(invoke: (command: string) => Promise<string>, fallback: LocaleDetector = () => typeof navigator !== 'undefined' ? navigator.language : undefined): I18nManager {
  return createI18nManager(async () => { try { return await invoke('get_system_locale'); } catch { return fallback(); } });
}

/** Mobile detector contract for react-native-localize (getLocales()[0].languageTag). */
export function createMobileI18nManager(getLocales: () => readonly { languageTag?: string }[]): I18nManager {
  return createI18nManager(() => getLocales()[0]?.languageTag);
}
