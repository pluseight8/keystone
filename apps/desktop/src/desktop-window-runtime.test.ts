import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DesktopShellController,
  DesktopWindowRegistry,
  PRIMARY_DESKTOP_WINDOW_ID,
  type DesktopStorage,
} from './desktop-shell-model';
import { isDesktopAltF4, parseDesktopWindowContext } from './desktop-window-runtime';
import { TauriEvent } from '@tauri-apps/api/event';

const windowRuntimeSource = readFileSync(new URL('./desktop-window-runtime.ts', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('./DesktopShell.tsx', import.meta.url), 'utf8');
const shellCssSource = readFileSync(new URL('./desktop-shell.css', import.meta.url), 'utf8');
const transferSource = readFileSync(new URL('./desktop-window-transfer.ts', import.meta.url), 'utf8');
const productizationSource = readFileSync(new URL('./desktop-productization.css', import.meta.url), 'utf8');
const nativeRuntimeSource = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

class TestStorage implements DesktopStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('desktop window context and registry', () => {
  it('uses a non-blocking destroyed event for native window lifecycle cleanup', () => {
    expect(TauriEvent.WINDOW_DESTROYED).toBe('tauri://destroyed');
    expect(windowRuntimeSource).toContain('current.listen(TauriEvent.WINDOW_DESTROYED');
    expect(windowRuntimeSource).not.toContain('onCloseRequested');
    expect(shellSource).toContain("window.addEventListener('beforeunload', onBeforeUnload)");
    expect(shellSource).toContain('shell.flush()');
  });

  it('keeps native close and canonical quit on one bounded shutdown path', () => {
    expect(nativeRuntimeSource).toContain('.on_window_event');
    expect(nativeRuntimeSource).toContain('window.label() == "main"');
    expect(nativeRuntimeSource).toContain('fn quit_keystone');
    expect(nativeRuntimeSource).toContain('tauri::RunEvent::Exit');
    expect(nativeRuntimeSource).toContain('app.state::<DesktopAudioState>().shutdown()');
    expect(nativeRuntimeSource).toContain('app.state::<DesktopVideoState>().shutdown()');
    expect(nativeRuntimeSource).not.toContain('std::process::exit(');
  });

  it('keeps a second native launch in the existing singleton window', () => {
    expect(nativeRuntimeSource).toContain('tauri_plugin_single_instance::init');
    expect(nativeRuntimeSource).toContain('app.get_webview_window("main")');
    expect(nativeRuntimeSource).toContain('window.set_focus()');
  });

  it('restores secondary windows only after the primary policy gate, sequentially', () => {
    expect(shellSource).not.toContain('if (windowContext.isPrimary) void restoreDetachedWindows(shell.listWindows());');
    expect(shellSource).toContain('startupSessionPolicyApplied');
    expect(shellSource).toContain("settings.values['tabs.restoreTabs']");
    expect(shellSource).toContain("settings.values['behavior.restoreWindows']");
    expect(windowRuntimeSource).toContain('if (!options.isPrimary || !isTauriAvailable()) return;');
    expect(windowRuntimeSource).toContain('const candidates = records.filter');
    expect(windowRuntimeSource).toContain('for (const record of candidates)');
    expect(windowRuntimeSource).not.toContain('Promise.all(records.filter');
  });

  it('keeps the user-facing layout reset available without deleting content', () => {
    expect(shellSource).toContain('Reset Window Session');
    expect(shellSource).toContain('shell.resetWindowAndTabLayout({ preserveTabs: false });');
    expect(productizationSource).toContain('.settings-reset-explainer');
  });

  it('keeps cross-window redock on the shared native event path', () => {
    expect(shellSource).toContain('pointermove');
    expect(shellSource).toContain('pointercancel');
    expect(shellSource).toContain('transferTransactionId');
    expect(shellSource).toContain('draggable onDragStart');
    expect(shellSource).toContain('onDragEnter={updateNativeTransferPreview}');
    expect(shellSource).toContain('onDrop={dropNativeTransfer}');
    expect(shellSource).toContain("window.addEventListener('dragover', onDragOver, true)");
    expect(shellSource).toContain("window.addEventListener('drop', onDrop, true)");
    expect(shellSource).toContain('secondaryRefreshTimers');
    expect(shellSource).toContain('DESKTOP_TAB_TRANSFER_DATA');
    expect(shellSource).toContain('acceptWindowTransfer');
    expect(shellSource).toContain('Merge window into');
    expect(transferSource).toContain("keystone:window-transfer");
    expect(transferSource).toContain('listenDesktopWindowTransfers');
    expect(transferSource).not.toContain('unsafe-eval');
    expect(productizationSource).toContain('.tab-strip-scroll { display: flex;');
    expect(productizationSource).toContain('.tab-strip { align-items: stretch; overflow: hidden;');
  });

  it('keeps the default shell to one toolbar, one tab strip, and a data-led Home', () => {
    expect(shellSource).toContain('className="header-workspace"');
    expect(shellSource).not.toContain('className="workspace-toolbar"');
    expect(shellSource).toContain('<NoticeToast notice={shell.currentNotice}');
    expect(shellSource).toContain('const showPaneToolbar = shell.getSnapshot().workspace.paneTree.type === \'split\';');
    expect(shellSource).toContain('tabs={shell.currentTabs()}');
    expect(shellSource).not.toContain('tabs={snapshot.workspace.tabs}');
    expect(shellSource).not.toContain('data-home-has-continue=');
    expect(shellSource).toContain('hasHomeColumns');
    expect(productizationSource).toContain('.desktop-environment { grid-template-rows: var(--ks-toolbar-height, 56px) var(--ks-tab-height, 42px) minmax(0, 1fr) auto; }');
    expect(productizationSource).toContain('.pane-split .pane-toolbar { display: flex; }');
    expect(productizationSource).toContain('.notice-toast {');
    expect(productizationSource).not.toContain('.workspace-toolbar { display: flex;');
    expect(productizationSource).not.toContain('.workspace-toolbar');
    expect(productizationSource).not.toContain('grid-template-rows: 54px');
    expect(productizationSource).not.toContain('!important');
    expect(shellCssSource).not.toContain('.workspace-toolbar');
    expect(shellCssSource).not.toContain('!important');
    expect(shellCssSource).not.toContain('font-weight:650');
  });

  it('parses only bounded window and tab identifiers from a Tauri app URL', () => {
    expect(parseDesktopWindowContext('?keystoneWindowId=window-1&keystoneTabId=tab-music')).toEqual({ windowId: 'window-1', detachedTabId: 'tab-music', isPrimary: false });
    expect(parseDesktopWindowContext('?keystoneWindowId=../../etc&keystoneTabId=%00')).toEqual({ windowId: 'main', isPrimary: true });
  });

  it('recognizes Alt+F4 as the canonical native quit shortcut', () => {
    expect(isDesktopAltF4({ altKey: true, key: 'F4', code: 'F4' })).toBe(true);
    expect(isDesktopAltF4({ altKey: true, key: 'Unidentified', code: 'F4' })).toBe(true);
    expect(isDesktopAltF4({ altKey: false, key: 'F4', code: 'F4' })).toBe(false);
    expect(isDesktopAltF4({ altKey: true, key: 'F3', code: 'F3' })).toBe(false);
    expect(shellSource).toContain('isDesktopAltF4(event)');
  });

  it('keeps the compositor-sensitive global shortcut optional and collision-safe', () => {
    expect(nativeRuntimeSource).toContain('fn window_toggle_shortcut()');
    expect(nativeRuntimeSource).toContain('Modifiers::CONTROL | Modifiers::ALT');
    expect(nativeRuntimeSource).toContain('Code::KeyK');
    expect(nativeRuntimeSource).toContain('continuing without it');
    expect(nativeRuntimeSource).toContain('.unregister(window_toggle_shortcut())');
    expect(nativeRuntimeSource).not.toContain('register(Shortcut::new(Some(Modifiers::ALT), Code::Space))?');
    expect(nativeRuntimeSource).not.toContain('shortcut == &Shortcut::new(Some(Modifiers::ALT), Code::Space)');
    expect(nativeRuntimeSource).not.toContain("'unsafe-eval'");
  });

  it('keeps each canonical tab owned by at most one native window', () => {
    const storage = new TestStorage();
    const shell = new DesktopShellController({ storage });
    const music = shell.openReference({ kind: 'music', id: 'music', label: 'Music' });
    expect(music).toBeTruthy();
    const registry = new DesktopWindowRegistry(storage);
    const main = registry.ensureWorkspace(shell.getSnapshot().workspace);
    const detached = registry.createDetached(shell.getSnapshot().workspace.id, music!.id);
    expect(detached?.primary).toBe(false);
    expect(registry.ownerOf(shell.getSnapshot().workspace.id, music!.id)?.id).toBe(detached?.id);
    expect(registry.ownerOf(shell.getSnapshot().workspace.id, music!.id)?.id).not.toBe(main.id);
    expect(registry.list(shell.getSnapshot().workspace.id).flatMap(window => window.tabIds).filter(id => id === music!.id)).toHaveLength(1);
    registry.remove(detached!.id, true);
    expect(registry.ownerOf(shell.getSnapshot().workspace.id, music!.id)?.id).toBe(PRIMARY_DESKTOP_WINDOW_ID);
  });

  it('restores one Home tab on a fresh profile and preserves the real tab order', () => {
    const storage = new TestStorage();
    const first = new DesktopShellController({ storage });
    expect(first.getSnapshot().workspace.tabs).toHaveLength(1);
    expect(first.currentTab?.object).toMatchObject({ kind: 'home', id: 'home' });
    const music = first.openReference({ kind: 'music', id: 'music', label: 'Music' });
    const tasks = first.openReference({ kind: 'tasks', id: 'tasks', label: 'Tasks' });
    const settings = first.openReference({ kind: 'settings', id: 'settings', label: 'Settings' });
    expect(music && tasks && settings).toBeTruthy();
    first.reorderTab(settings!.id, 1);
    const restarted = new DesktopShellController({ storage });
    expect(restarted.getSnapshot().workspace.tabs.map(tab => tab.title)).toEqual(['Home', 'Settings', 'Music', 'Tasks']);
    expect(restarted.openReference({ kind: 'settings', id: 'settings', label: 'Settings' })?.id).toBe(settings!.id);
    expect(restarted.getSnapshot().workspace.tabs.filter(tab => tab.object?.kind === 'settings' && tab.object.id === 'settings')).toHaveLength(1);
  });

  it('does not force a configured startup surface over a fresh Home session', () => {
    const storage = new TestStorage();
    storage.setItem('keystone.desktop.startup-surface.v1', JSON.stringify({ version: 1, surface: 'feed' }));
    const shell = new DesktopShellController({ storage });
    expect(shell.getSnapshot().workspace.tabs).toHaveLength(1);
    expect(shell.currentTab?.object).toMatchObject({ kind: 'home', id: 'home' });
  });

  it('keeps Quick Capture a normal singleton only when the full tray is explicitly opened', () => {
    const shell = new DesktopShellController({ storage: new TestStorage() });
    shell.openReference({ kind: 'capture', id: 'capture', label: 'Quick Capture' });
    shell.openReference({ kind: 'capture', id: 'capture', label: 'Quick Capture' });
    expect(shell.getSnapshot().workspace.tabs.filter(tab => tab.object?.kind === 'capture' && tab.object.id === 'capture')).toHaveLength(1);
  });

  it('detaches a real tab through the native bridge and leaves no duplicate in the source window', async () => {
    const storage = new TestStorage();
    const opened: string[] = [];
    const shell = new DesktopShellController({
      storage,
      windowBridge: {
        open: request => { opened.push(request.windowId); return true; },
        focus: () => undefined,
      },
    });
    const music = shell.openReference({ kind: 'music', id: 'music', label: 'Music' });
    expect(await shell.openTabInNewWindow(music?.id)).toBe(true);
    expect(opened).toHaveLength(1);
    expect(shell.getSnapshot().workspace.tabs.some(tab => tab.id === music?.id)).toBe(false);
    expect(shell.listWindows()).toHaveLength(2);
    const detached = shell.listWindows().find(window => !window.primary);
    expect(detached?.tabIds).toEqual([music?.id]);
    const restartedMain = new DesktopShellController({ storage });
    expect(restartedMain.getSnapshot().workspace.tabs.some(tab => tab.id === music?.id)).toBe(false);
    expect(new DesktopWindowRegistry(storage).ownerOf(shell.getSnapshot().workspace.id, music!.id)?.id).toBe(detached?.id);
    const restartedDetached = new DesktopShellController({ storage, windowId: detached!.id, detachedTabId: music!.id });
    expect(restartedDetached.currentTab?.id).toBe(music?.id);
  });

  it('transfers a tab to an existing native window and closes an empty secondary window', () => {
    const storage = new TestStorage();
    const closed: string[] = [];
    const shell = new DesktopShellController({
      storage,
      windowBridge: {
        open: () => true,
        focus: () => undefined,
        closeSelf: () => { closed.push('secondary'); },
      },
    });
    const music = shell.openReference({ kind: 'music', id: 'music', label: 'Music' });
    const detached = new DesktopWindowRegistry(storage).createDetached(shell.getSnapshot().workspace.id, music!.id);
    expect(detached).toBeTruthy();
    const child = new DesktopShellController({ storage, windowId: detached!.id, detachedTabId: music!.id, windowBridge: { open: () => true, focus: () => undefined, closeSelf: () => { closed.push('secondary'); } } });
    expect(child.transferTabToWindow(music!.id, PRIMARY_DESKTOP_WINDOW_ID)).toBe(true);
    expect(closed).toEqual(['secondary']);
    expect(new DesktopWindowRegistry(storage).ownerOf(shell.getSnapshot().workspace.id, music!.id)?.id).toBe(PRIMARY_DESKTOP_WINDOW_ID);
  });
});
