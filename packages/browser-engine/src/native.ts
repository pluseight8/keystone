import { requireNativeModule } from 'expo-modules-core';
import type { BrowserModule } from './index.js';
export const mobileBrowserModule = requireNativeModule<BrowserModule>('KeystoneBrowser');
