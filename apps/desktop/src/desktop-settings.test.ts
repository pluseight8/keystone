import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESKTOP_SETTINGS,
  DESKTOP_SETTING_REGISTRY,
  DESKTOP_SETTINGS_KEY,
  DESKTOP_SESSION_RESTORE_POLICY_KEY,
  DesktopSettingsStore,
  desktopThemeColors,
  findDesktopShortcutConflicts,
  validateCustomCss,
  validateSetting,
  type DesktopStorage,
} from './desktop-settings';

class TestStorage implements DesktopStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('canonical desktop settings registry', () => {
  it('starts with readable geometry and typography defaults', () => {
    expect(DEFAULT_DESKTOP_SETTINGS['appearance.baseFontSize']).toBe(14);
    expect(DEFAULT_DESKTOP_SETTINGS['layout.contentMaxWidth']).toBe(1400);
    expect(DEFAULT_DESKTOP_SETTINGS['layout.toolbarHeight']).toBe(56);
    expect(DEFAULT_DESKTOP_SETTINGS['layout.tabHeight']).toBe(42);
    expect(DEFAULT_DESKTOP_SETTINGS['layout.statusBarHeight']).toBe(30);
    expect(DEFAULT_DESKTOP_SETTINGS['tabs.minWidth']).toBe(112);
    expect(DEFAULT_DESKTOP_SETTINGS['tabs.maxWidth']).toBe(240);
    expect(DEFAULT_DESKTOP_SETTINGS['tabs.restoreTabs']).toBe(false);
    expect(DEFAULT_DESKTOP_SETTINGS['behavior.restoreWindows']).toBe(false);
  });

  it('keeps session restoration disabled until a versioned explicit opt-in exists', () => {
    const storage = new TestStorage();
    expect(storage.getItem(DESKTOP_SESSION_RESTORE_POLICY_KEY)).toBeNull();
    const store = new DesktopSettingsStore(storage);
    expect(store.effective().values['tabs.restoreTabs']).toBe(false);
    expect(store.effective().values['behavior.restoreWindows']).toBe(false);
    expect(store.set('tabs.restoreTabs', true).ok).toBe(true);
    expect(store.set('behavior.restoreWindows', true).ok).toBe(true);
    expect(JSON.parse(storage.getItem(DESKTOP_SESSION_RESTORE_POLICY_KEY) ?? '{}')).toEqual({ version: 1, enabled: true });
    expect(store.disableAutomaticSessionRestore().ok).toBe(true);
    expect(store.effective().values['tabs.restoreTabs']).toBe(false);
    expect(store.effective().values['behavior.restoreWindows']).toBe(false);
    expect(JSON.parse(storage.getItem(DESKTOP_SESSION_RESTORE_POLICY_KEY) ?? '{}')).toEqual({ version: 1, enabled: false });
  });

  it('keeps light and dark semantic defaults distinct when no owner color override exists', () => {
    expect(desktopThemeColors('light').background).toBe('#f5f7f9');
    expect(desktopThemeColors('dark').background).toBe('#09090a');
    expect(DEFAULT_DESKTOP_SETTINGS['appearance.colors']).toEqual({});
  });

  it('has unique typed metadata and a default for every setting', () => {
    const ids = DESKTOP_SETTING_REGISTRY.map(definition => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const definition of DESKTOP_SETTING_REGISTRY) {
      expect(definition.label.en).toBeTruthy();
      expect(definition.label.ru).toBeTruthy();
      expect(definition.description.en).toBeTruthy();
      expect(definition.description.ru).toBeTruthy();
      expect(definition.scope).toBeTruthy();
      expect(definition.securityClass).toBeTruthy();
      expect((DEFAULT_DESKTOP_SETTINGS as Record<string, unknown>)[definition.id]).toBeDefined();
    }
  });

  it('migrates the legacy v1 preferences into versioned v2 storage', () => {
    const storage = new TestStorage();
    storage.setItem('keystone.desktop.preferences.v1', JSON.stringify({ theme: 'light', accent: 'blue', density: 'compact', reducedMotion: true, visualEffects: false }));
    const store = new DesktopSettingsStore(storage);
    const snapshot = store.effective({ deviceId: 'device-1', workspaceId: 'workspace-1' });
    expect(snapshot.values['appearance.theme']).toBe('light');
    expect(snapshot.values['appearance.accent']).toBe('blue');
    expect(snapshot.values['appearance.density']).toBe('compact');
    expect(snapshot.values['motion.mode']).toBe('reduced');
    expect(snapshot.values['appearance.shadowPreset']).toBe('off');
    expect(storage.getItem(DESKTOP_SETTINGS_KEY)).toContain('"version":2');
  });

  it('resolves global, workspace, surface and window inheritance with source labels', () => {
    const store = new DesktopSettingsStore(new TestStorage());
    const context = { deviceId: 'device-1', workspaceId: 'workspace-1', surfaceId: 'home', windowId: 'window-1' } as const;
    expect(store.set('appearance.theme', 'light', 'global', context).ok).toBe(true);
    expect(store.set('appearance.theme', 'dark', 'workspace', context).ok).toBe(true);
    expect(store.set('appearance.theme', 'system', 'surface', context).ok).toBe(true);
    expect(store.set('appearance.theme', 'light', 'window', context).ok).toBe(true);
    const snapshot = store.effective(context);
    expect(snapshot.values['appearance.theme']).toBe('light');
    expect(snapshot.sources['appearance.theme']).toBe('window');
    expect(store.reset('appearance.theme', 'window', context).ok).toBe(true);
    expect(store.effective(context).values['appearance.theme']).toBe('system');
    expect(store.effective(context).sources['appearance.theme']).toBe('surface');
  });

  it('rejects invalid values and keeps the persisted document safe', () => {
    expect(validateSetting('appearance.uiScale', 4).ok).toBe(false);
    expect(validateSetting('appearance.customAccent', 'red').ok).toBe(false);
    expect(validateSetting('home.sectionOrder', ['continue']).ok).toBe(false);
    const storage = new TestStorage();
    const store = new DesktopSettingsStore(storage);
    expect(store.set('appearance.uiScale', 4).ok).toBe(false);
    expect(store.set('appearance.uiScale', 1.15).ok).toBe(true);
    expect(JSON.parse(storage.getItem(DESKTOP_SETTINGS_KEY) ?? '{}').global['appearance.uiScale']).toBe(1.15);
  });

  it('migrates the obsolete Home launcher section without changing real data sections', () => {
    const storage = new TestStorage();
    storage.setItem(DESKTOP_SETTINGS_KEY, JSON.stringify({
      version: 2,
      global: {},
      devices: {},
      workspaces: { 'workspace-1': { 'home.sectionOrder': ['continue', 'quick-actions', 'today', 'recent', 'pinned'] } },
      surfaces: {},
      windows: {},
      customCss: { enabled: false, css: '' },
    }));
    const store = new DesktopSettingsStore(storage);
    expect(store.effective({ workspaceId: 'workspace-1' }).values['home.sectionOrder']).toEqual(['continue', 'today', 'recent', 'pinned']);
    expect(JSON.parse(storage.getItem(DESKTOP_SETTINGS_KEY) ?? '{}').workspaces['workspace-1']['home.sectionOrder']).toEqual(['continue', 'today', 'recent', 'pinned']);
  });

  it('does not expose immutable security policy as a mutable preference', () => {
    const store = new DesktopSettingsStore(new TestStorage());
    expect(store.set('security.allowRemoteScripts', true).ok).toBe(false);
    expect(JSON.stringify(store.exportSafe())).not.toContain('allowRemoteScripts');
  });

  it('detects duplicate shortcut assignments before they become silent conflicts', () => {
    const store = new DesktopSettingsStore(new TestStorage());
    expect(store.set('shortcuts.newTab', 'Ctrl+K').ok).toBe(true);
    expect(findDesktopShortcutConflicts(store.effective().values)).toEqual([
      { shortcut: 'ctrl+k', ids: ['shortcuts.commandPalette', 'shortcuts.newTab'] },
    ]);
  });

  it('accepts CSS only when it has no executable or remote constructs', () => {
    expect(validateCustomCss('[data-keystone-region="content"] { color: #fff; }').ok).toBe(true);
    expect(validateCustomCss('@import url(https://example.test/x.css);').ok).toBe(false);
    expect(validateCustomCss('[data-keystone-region="content"] { color: red;').ok).toBe(false);
    expect(validateCustomCss('[data-keystone-region="content"] { background: url(data:image/png;base64,abc); }').ok).toBe(false);
  });

  it('supports undo, redo, presets, safe export and import preview', () => {
    const storage = new TestStorage();
    const store = new DesktopSettingsStore(storage);
    expect(store.set('appearance.accent', 'blue').ok).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.get('appearance.accent')).toBe('rose');
    expect(store.redo()).toBe(true);
    expect(store.get('appearance.accent')).toBe('blue');
    expect(store.applyPreset('compact').ok).toBe(true);
    expect(store.get('appearance.density')).toBe('compact');
    const exported = JSON.parse(store.exportSafe()) as Record<string, unknown>;
    expect(exported.schema).toBe('keystone-settings');
    expect(exported.version).toBe(2);
    expect(JSON.stringify(exported)).not.toContain('seed');
    const preview = store.previewImport(JSON.stringify({ schema: 'keystone-settings', version: 2, global: { 'appearance.theme': 'dark' } }));
    expect(preview.ok).toBe(true);
    expect(preview.changes).toHaveLength(1);
    expect(store.importSafe(JSON.stringify({ schema: 'keystone-settings', version: 2, global: { 'appearance.theme': 'dark' } })).ok).toBe(true);
    expect(store.get('appearance.theme')).toBe('dark');
  });
});
