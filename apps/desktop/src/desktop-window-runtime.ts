import { invoke } from '@tauri-apps/api/core';
import { TauriEvent } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type {
  DesktopWindowBridge,
  DesktopWindowGeometry,
  DesktopWindowOpenRequest,
  DesktopWindowRecord,
} from './desktop-shell-model';

export interface DesktopWindowContext {
  readonly windowId: string;
  readonly detachedTabId?: string;
  readonly isPrimary: boolean;
}

const SAFE_WINDOW_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/;

export function isTauriAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export async function requestDesktopQuit(): Promise<boolean> {
  if (!isTauriAvailable()) return false;
  try {
    await invoke('quit_keystone');
    return true;
  } catch {
    return false;
  }
}

export function parseDesktopWindowContext(search = typeof window !== 'undefined' ? window.location.search : ''): DesktopWindowContext {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const candidate = params.get('keystoneWindowId')?.trim() ?? '';
  const windowId = SAFE_WINDOW_ID.test(candidate) ? candidate : 'main';
  const tabCandidate = params.get('keystoneTabId')?.trim() ?? '';
  const detachedTabId = tabCandidate && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(tabCandidate) ? tabCandidate : undefined;
  return { windowId, ...(detachedTabId ? { detachedTabId } : {}), isPrimary: windowId === 'main' };
}

export function getDesktopWindowContext(): DesktopWindowContext {
  return parseDesktopWindowContext();
}

export function isDesktopAltF4(event: Pick<KeyboardEvent, 'altKey' | 'key' | 'code'>): boolean {
  return event.altKey && (event.key === 'F4' || event.code === 'F4');
}

export function desktopWindowBridge(): DesktopWindowBridge {
  return {
    open: async (request: DesktopWindowOpenRequest) => {
      if (!isTauriAvailable()) return false;
      return invoke<boolean>('open_keystone_window', { request }).catch(() => false);
    },
    focus: async (windowId: string) => {
      if (isTauriAvailable()) await invoke('focus_keystone_window', { windowId });
    },
    close: async (windowId: string) => {
      if (isTauriAvailable()) await invoke('close_keystone_window', { windowId });
    },
    closeSelf: async () => {
      if (isTauriAvailable()) await getCurrentWindow().close();
    },
  };
}

export async function restoreDetachedWindows(records: readonly DesktopWindowRecord[], options: { readonly isPrimary: boolean }): Promise<void> {
  if (!options.isPrimary || !isTauriAvailable()) return;
  // Native WebViews and their localStorage observers start asynchronously.
  // Opening every restored window in parallel made them race the primary
  // shell and could produce duplicate/blank windows. Restore one validated
  // owner at a time; the native command itself also focuses an existing label.
  const candidates = records.filter(record => !record.primary && record.id && record.tabIds[0]);
  for (const record of candidates) {
    await invoke<boolean>('open_keystone_window', {
      request: {
        windowId: record.id,
        tabId: record.tabIds[0],
        title: 'Keystone',
        ...(record.geometry?.x !== undefined ? { x: record.geometry.x } : {}),
        ...(record.geometry?.y !== undefined ? { y: record.geometry.y } : {}),
        ...(record.geometry?.width !== undefined ? { width: record.geometry.width } : {}),
        ...(record.geometry?.height !== undefined ? { height: record.geometry.height } : {}),
        ...(record.geometry?.maximized !== undefined ? { maximized: record.geometry.maximized } : {}),
        ...(record.geometry?.fullscreen !== undefined ? { fullscreen: record.geometry.fullscreen } : {}),
      } satisfies DesktopWindowOpenRequest,
    }).catch(() => false);
  }
}

export async function observeDesktopWindowGeometry(
  windowId: string,
  onChange: (geometry: DesktopWindowGeometry) => void,
  onClose?: () => void,
): Promise<() => void> {
  if (!isTauriAvailable()) return () => undefined;
  const current = getCurrentWindow();
  const read = async () => {
    try {
      const [position, size, maximized, fullscreen] = await Promise.all([current.outerPosition(), current.outerSize(), current.isMaximized(), current.isFullscreen()]);
      onChange({ x: position.x, y: position.y, width: size.width, height: size.height, maximized, fullscreen });
    } catch {
      // Geometry is an enhancement; a compositor/monitor transition must not
      // take down the shell.
    }
  };
  await read();
  const unlisteners = await Promise.all([
    current.onMoved(() => { void read(); }),
    current.onResized(() => { void read(); }),
    // Tauri treats the presence of a WINDOW_CLOSE_REQUESTED listener as an
    // implicit prevent_close. Observe destruction instead so native close,
    // Alt+F4, and app shutdown retain their normal lifecycle semantics.
    current.listen(TauriEvent.WINDOW_DESTROYED, () => { onClose?.(); }),
  ]);
  void windowId;
  return () => unlisteners.forEach(unlisten => unlisten());
}
