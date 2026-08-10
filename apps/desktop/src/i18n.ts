import { invoke } from '@tauri-apps/api/core';
import { i18n } from '@keystone/core';

/** Offline desktop locale source backed by the native Tauri command. */
i18n.configureDetector(() => invoke<string>('get_system_locale'));
export const desktopI18n = i18n;
