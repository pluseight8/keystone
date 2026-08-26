/**
 * Browser/renderer-safe Core entry.
 *
 * The full Core barrel also exposes native transport and migration surfaces
 * for Node/Tauri-side consumers. Renderer builds should import only the
 * small set of UI services that are safe to evaluate in a browser context.
 * Host capabilities remain typed projections installed by the application.
 */

export { i18n, createI18nManager, dictionariesByLocale } from './i18n/index.js';
export { CaptureService } from './capture.js';
export { ContactService } from './contacts.js';
export { TaskService } from './tasks.js';
