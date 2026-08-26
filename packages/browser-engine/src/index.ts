export type BrowserPlatform = 'tauri' | 'android-gecko' | 'ios-wkwebview';
export interface ConfirmedBrowserPayload { origin: string; fields: Record<string,string>; confirmationToken: string; expiresAt: string; }
export interface BrowserEngine { readonly platform: BrowserPlatform; open(url:string): Promise<void>; close(): Promise<void>; inject(payload: ConfirmedBrowserPayload): Promise<void>; }
export interface BrowserModule { open(url:string): Promise<void>; close(): Promise<void>; inject(payload: ConfirmedBrowserPayload): Promise<void>; }
export class NativeBrowserEngine implements BrowserEngine { constructor(public readonly platform: BrowserPlatform, private readonly native: BrowserModule) {} open(url:string){return this.native.open(url)} close(){return this.native.close()} inject(payload:ConfirmedBrowserPayload){return this.native.inject(payload)} }
export function assertConfirmedPayload(payload: ConfirmedBrowserPayload): void { const origin = new URL(payload.origin); if (origin.protocol !== 'https:') throw new Error('Browser automation requires HTTPS'); if (!payload.confirmationToken || payload.confirmationToken.length < 32) throw new Error('Invalid confirmation token'); if (Date.parse(payload.expiresAt) <= Date.now()) throw new Error('Browser payload expired'); }

export * from './agent-runtime.js';
