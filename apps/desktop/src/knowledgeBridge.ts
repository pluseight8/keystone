import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
export interface NativeLocalFile { path: string; size: number; modifiedAt?: number; }
export interface NativeFileChange { root: string; paths: string[]; kind: string; }
export const desktopKnowledgeBridge = {
  pickFolder: (): Promise<string | null> => invoke('pick_local_folder'),
  scan: (root: string): Promise<NativeLocalFile[]> => invoke('scan_local_folder', { root }),
  read: async (path: string): Promise<Uint8Array> => Uint8Array.from(await invoke<number[]>('read_local_document', { path })),
  extractPdf: (bytes: Uint8Array): Promise<string> => invoke('extract_pdf_text', { bytes: Array.from(bytes) }),
  watch: (root: string): Promise<void> => invoke('watch_local_folder', { root }),
  unwatch: (root: string): Promise<void> => invoke('unwatch_local_folder', { root }),
  onChange: (handler: (event: NativeFileChange) => void): Promise<UnlistenFn> => listen<NativeFileChange>('knowledge://file-change', event => handler(event.payload)),
};
