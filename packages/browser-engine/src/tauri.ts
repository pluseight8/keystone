import { invoke } from '@tauri-apps/api/core';
import type { BrowserModule } from './index.js';
export const tauriBrowserModule: BrowserModule = { open: url => invoke('open_automation_browser',{url}), close: () => invoke('close_automation_browser'), inject: payload => invoke('inject_confirmed_data',{payload}) };
