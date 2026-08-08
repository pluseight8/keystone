import { invoke } from '@tauri-apps/api/core';

export interface ConfirmedInjection { origin: string; fields: Record<string, string>; confirmationToken: string; expiresAt: string; }
export function openAutomationBrowser(url: string): Promise<void> { return invoke('open_automation_browser', { url }); }
/** Invoke only after core has verified both signatures and the UI showed consent. */
export function injectConfirmedData(payload: ConfirmedInjection): Promise<void> {
  return invoke('inject_confirmed_data', { payload });
}
