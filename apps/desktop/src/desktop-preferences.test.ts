import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESKTOP_PREFERENCES,
  DESKTOP_PREFERENCES_KEY,
  desktopAccentValue,
  readDesktopPreferences,
  resolveDesktopTheme,
  updateDesktopPreferences,
  writeDesktopPreferences,
  type DesktopStorage,
} from './desktop-preferences';

class TestStorage implements DesktopStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('desktop preferences', () => {
  it('uses safe defaults and persists only supported values', () => {
    const storage = new TestStorage();
    expect(readDesktopPreferences(storage)).toEqual(DEFAULT_DESKTOP_PREFERENCES);
    const saved = writeDesktopPreferences({
      ...DEFAULT_DESKTOP_PREFERENCES,
      theme: 'dark',
      accent: 'custom',
      customAccent: '#ABCDEF',
      density: 'compact',
      sidebarSize: 'wide',
      reducedMotion: true,
      visualEffects: false,
    }, storage);
    expect(saved).toMatchObject({ theme: 'dark', customAccent: '#abcdef', density: 'compact', sidebarSize: 'wide', reducedMotion: true, visualEffects: false });
    expect(JSON.parse(storage.getItem(DESKTOP_PREFERENCES_KEY) ?? '{}')).toMatchObject({ version: 1, theme: 'dark' });
  });

  it('recovers from malformed values and supports incremental updates', () => {
    const storage = new TestStorage();
    storage.setItem(DESKTOP_PREFERENCES_KEY, '{bad');
    expect(readDesktopPreferences(storage)).toEqual(DEFAULT_DESKTOP_PREFERENCES);
    const next = updateDesktopPreferences({ theme: 'light', accent: 'blue' }, storage);
    expect(next.theme).toBe('light');
    expect(next.accent).toBe('blue');
  });

  it('migrates the previous reduced-motion preference when no v1 record exists', () => {
    const storage = new TestStorage();
    storage.setItem('keystone.ui.reduced-motion', '1');
    expect(readDesktopPreferences(storage).reducedMotion).toBe(true);
  });

  it('resolves system appearance and custom accent safely', () => {
    expect(resolveDesktopTheme('system', true)).toBe('dark');
    expect(resolveDesktopTheme('system', false)).toBe('light');
    expect(desktopAccentValue({ accent: 'custom', customAccent: '#123456' })).toBe('#123456');
    expect(desktopAccentValue({ accent: 'custom', customAccent: 'not-a-color' })).toBe('#e9254d');
  });
});
