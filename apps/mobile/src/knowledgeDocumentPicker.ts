import type { DocumentInput } from '@keystone/core';
export interface MobilePickedDocument { uri: string; name: string; mimeType?: string; size?: number; }
export interface NativeDocumentPicker {
  /** Android implementation uses ACTION_OPEN_DOCUMENT and persists its URI read grant. */
  pickDocuments(options: { mimeTypes: string[]; multiple: boolean; copyToCache: boolean }): Promise<MobilePickedDocument[]>;
  readBytes(uri: string): Promise<Uint8Array>;
}
/** SAF-compatible adapter; inject an Expo/native-module implementation at the app boundary. */
export class MobileDocumentPickerAdapter {
  constructor(private readonly native: NativeDocumentPicker) {}
  async pick(): Promise<DocumentInput[]> { const selected = await this.native.pickDocuments({ mimeTypes: ['text/plain', 'text/markdown', 'text/csv', 'application/pdf'], multiple: true, copyToCache: false }); return Promise.all(selected.map(async document => ({ path: document.name || document.uri, mimeType: document.mimeType, bytes: await this.native.readBytes(document.uri) }))); }
}

export function bytesFromBase64(value: string): Uint8Array {
  const decode = globalThis.atob;
  if (!decode) throw new Error('Base64 decoding is unavailable');
  const binary = decode(value); return Uint8Array.from(binary, character => character.charCodeAt(0));
}
