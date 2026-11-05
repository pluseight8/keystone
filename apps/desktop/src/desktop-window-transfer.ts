import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { DesktopTab } from './desktop-shell-model';

/**
 * Cross-WebView tab transfer is deliberately a small protocol instead of a
 * React-only drag state.  A native window can leave the source WebView while
 * the browser drag is still alive, so every participant receives the bounded
 * transfer description through the Tauri event bus.
 */
export const DESKTOP_WINDOW_TRANSFER_EVENT = 'keystone:window-transfer';
export const DESKTOP_WINDOW_TRANSFER_DOM_EVENT = 'keystone-window-transfer';
export const DESKTOP_TAB_TRANSFER_DATA = 'application/x-keystone-tab';
export const DESKTOP_WINDOW_TRANSFER_STORAGE_KEY = 'keystone.desktop.window-transfer.v1';

export interface DesktopWindowTransferStart {
  readonly type: 'start';
  readonly transactionId: string;
  readonly workspaceId: string;
  readonly sourceWindowId: string;
  readonly tabId: string;
  readonly sourceIndex: number;
  readonly tab: DesktopTab;
}

export interface DesktopWindowTransferHover {
  readonly type: 'hover';
  readonly transactionId: string;
  readonly workspaceId: string;
  readonly sourceWindowId: string;
  readonly targetWindowId: string;
  readonly tabId: string;
  readonly targetIndex: number;
}

export interface DesktopWindowTransferResult {
  readonly type: 'accepted' | 'rejected' | 'committed';
  readonly transactionId: string;
  readonly workspaceId: string;
  readonly sourceWindowId: string;
  readonly targetWindowId: string;
  readonly tabId: string;
  readonly targetIndex?: number;
  readonly reason?: string;
}

export interface DesktopWindowTransferCancel {
  readonly type: 'cancel';
  readonly transactionId: string;
  readonly workspaceId: string;
  readonly sourceWindowId: string;
  readonly tabId: string;
}

export type DesktopWindowTransferEvent =
  | DesktopWindowTransferStart
  | DesktopWindowTransferHover
  | DesktopWindowTransferResult
  | DesktopWindowTransferCancel;

function tauriAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function dispatchLocal(event: DesktopWindowTransferEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<DesktopWindowTransferEvent>(DESKTOP_WINDOW_TRANSFER_DOM_EVENT, { detail: event }));
}

export function createDesktopTransferId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `tab-transfer-${random}`.slice(0, 128);
}

/** Keep the protocol payload bounded and free of mutable object references. */
export function cloneDesktopTransferTab(tab: DesktopTab): DesktopTab {
  return {
    ...tab,
    id: tab.id.slice(0, 128),
    title: tab.title.slice(0, 120),
    ...(tab.object ? { object: { ...tab.object, id: tab.object.id.slice(0, 256), ...(tab.object.label ? { label: tab.object.label.slice(0, 120) } : {}) } } : {}),
  };
}

export async function emitDesktopWindowTransfer(event: DesktopWindowTransferEvent): Promise<void> {
  dispatchLocal(event);
  // Tauri emits globally in the normal host path.  WebKitGTK can still bring
  // up a newly-created sibling WebView before its event listener is attached,
  // so mirror the bounded event in the shared app-local storage channel. A
  // storage event is delivered to the other WebViews, never to this one.
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(DESKTOP_WINDOW_TRANSFER_STORAGE_KEY, JSON.stringify(event)); } catch { /* optional fallback */ }
  }
  if (!tauriAvailable()) return;
  await emit(DESKTOP_WINDOW_TRANSFER_EVENT, event).catch(() => undefined);
}

export async function listenDesktopWindowTransfers(handler: (event: DesktopWindowTransferEvent) => void): Promise<UnlistenFn> {
  if (!tauriAvailable()) return () => undefined;
  return listen<DesktopWindowTransferEvent>(DESKTOP_WINDOW_TRANSFER_EVENT, event => handler(event.payload));
}

export function parseDesktopTransferStart(raw: string): DesktopWindowTransferStart | undefined {
  try {
    const value = JSON.parse(raw) as Partial<DesktopWindowTransferStart>;
    if (value.type !== 'start' || typeof value.transactionId !== 'string' || typeof value.workspaceId !== 'string' || typeof value.sourceWindowId !== 'string' || typeof value.tabId !== 'string' || !value.tab) return undefined;
    if (!value.transactionId || !value.workspaceId || !value.sourceWindowId || !value.tabId || value.tab.id !== value.tabId) return undefined;
    return {
      type: 'start',
      transactionId: value.transactionId.slice(0, 128),
      workspaceId: value.workspaceId.slice(0, 128),
      sourceWindowId: value.sourceWindowId.slice(0, 128),
      tabId: value.tabId.slice(0, 128),
      sourceIndex: Number.isSafeInteger(value.sourceIndex) ? Math.max(0, Math.min(100, value.sourceIndex as number)) : 0,
      tab: cloneDesktopTransferTab(value.tab),
    };
  } catch {
    return undefined;
  }
}

export function parseDesktopWindowTransferEvent(raw: string): DesktopWindowTransferEvent | undefined {
  try {
    const value = JSON.parse(raw) as Partial<DesktopWindowTransferEvent> & { tab?: DesktopTab };
    if (value.type === 'start') return parseDesktopTransferStart(raw);
    if (value.type === 'cancel') {
      if (typeof value.transactionId !== 'string' || typeof value.workspaceId !== 'string' || typeof value.sourceWindowId !== 'string' || typeof value.tabId !== 'string') return undefined;
      return { type: 'cancel', transactionId: value.transactionId.slice(0, 128), workspaceId: value.workspaceId.slice(0, 128), sourceWindowId: value.sourceWindowId.slice(0, 128), tabId: value.tabId.slice(0, 128) };
    }
    if (value.type === 'accepted' || value.type === 'rejected' || value.type === 'committed') {
      if (typeof value.transactionId !== 'string' || typeof value.workspaceId !== 'string' || typeof value.sourceWindowId !== 'string' || typeof value.targetWindowId !== 'string' || typeof value.tabId !== 'string') return undefined;
      return {
        type: value.type,
        transactionId: value.transactionId.slice(0, 128),
        workspaceId: value.workspaceId.slice(0, 128),
        sourceWindowId: value.sourceWindowId.slice(0, 128),
        targetWindowId: value.targetWindowId.slice(0, 128),
        tabId: value.tabId.slice(0, 128),
        ...(Number.isSafeInteger(value.targetIndex) ? { targetIndex: Math.max(0, Math.min(100, value.targetIndex as number)) } : {}),
        ...(typeof value.reason === 'string' ? { reason: value.reason.slice(0, 240) } : {}),
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
