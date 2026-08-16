import en from './en.json';
import ru from './ru.json';
export type Locale = 'en' | 'ru';
export type I18nDictionary = typeof en;
export type LocaleDetector = () => string | undefined | Promise<string | undefined>;
const dictionaries: Record<Locale, I18nDictionary> = { en, ru };
const STORAGE_KEY = 'keystone.locale';
function normalize(value?: string | null): Locale | undefined { const language = value?.toLowerCase().split(/[-_]/)[0]; return language === 'ru' ? 'ru' : language === 'en' ? 'en' : undefined; }
export class I18nManager {
 private locale: Locale = 'en'; private forced = false; private readonly listeners = new Set<(locale: Locale) => void>();
 constructor(private detector?: LocaleDetector, private readonly storage: Storage | undefined = typeof globalThis !== 'undefined' && 'localStorage' in globalThis ? globalThis.localStorage : undefined) { this.locale = normalize(this.storage?.getItem(STORAGE_KEY)) ?? normalize(typeof navigator !== 'undefined' ? navigator.language : undefined) ?? 'en'; this.forced = !!this.storage?.getItem(STORAGE_KEY); }
 getLocale(): Locale { return this.locale; }
 configureDetector(detector: LocaleDetector): void { this.detector = detector; }
 async detect(): Promise<Locale> { if (this.forced) return this.locale; const detected = normalize(await this.detector?.()); if (detected && detected !== this.locale) { this.locale = detected; this.emit(); } return this.locale; }
 setLocale(locale: Locale, persist = true): void { this.locale = locale; this.forced = persist; if (persist) this.storage?.setItem(STORAGE_KEY, locale); else this.storage?.removeItem(STORAGE_KEY); this.emit(); }
 subscribe(listener: (locale: Locale) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
 t(key: string, params: Record<string, string | number> = {}): string { const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionaries[this.locale]); if (typeof value !== 'string') return key; return value.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`)); }
 private emit(): void { this.listeners.forEach(listener => listener(this.locale)); }
}
export const i18n = new I18nManager();
export const createI18nManager = (detector?: LocaleDetector, storage?: Storage) => new I18nManager(detector, storage);
export const dictionariesByLocale = dictionaries;
