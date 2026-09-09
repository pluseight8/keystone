import type { DesktopShellController, ShellCommand } from './desktop-shell-model';
import { requestDesktopQuit } from './desktop-window-runtime';

/**
 * The shell command palette is backed by one action registry.  These actions
 * only navigate to real surfaces; they never pretend that an unavailable host
 * adapter is connected.
 */
export interface DesktopActionDefinition {
  readonly id: string;
  readonly label: { readonly en: string; readonly ru: string };
  readonly description: { readonly en: string; readonly ru: string };
  readonly keywords: readonly string[];
  readonly run: (shell: DesktopShellController, locale: 'en' | 'ru') => void;
}

export const DESKTOP_ACTION_REGISTRY: readonly DesktopActionDefinition[] = [
  { id: 'keystone.quit', label: { en: 'Quit Keystone', ru: 'Выйти из Keystone' }, description: { en: 'Close Keystone and stop its local runtime cleanly.', ru: 'Закрыть Keystone и корректно остановить локальный runtime.' }, keywords: ['quit', 'exit', 'close app', 'выйти', 'завершить'], run: () => { void requestDesktopQuit(); } },
  { id: 'keystone.customize', label: { en: 'Customize Keystone', ru: 'Настроить Keystone' }, description: { en: 'Open owner-controlled appearance and layout settings.', ru: 'Открыть настройки оформления и компоновки владельца.' }, keywords: ['customize', 'personalize', 'appearance', 'layout', 'настроить', 'оформление'], run: (shell, locale) => shell.openReference({ kind: 'settings', id: 'customize', label: locale === 'ru' ? 'Настроить Keystone' : 'Customize Keystone' }) },
  { id: 'keystone.settings.layout', label: { en: 'Customize layout', ru: 'Настроить компоновку' }, description: { en: 'Open the real shell layout controls.', ru: 'Открыть настоящие настройки компоновки shell.' }, keywords: ['layout', 'sidebar', 'toolbar', 'панель', 'компоновка'], run: (shell, locale) => shell.openReference({ kind: 'settings', id: 'settings', query: 'layout', label: locale === 'ru' ? 'Компоновка' : 'Layout' }, { allowDuplicate: true }) },
  { id: 'keystone.session.reset-layout', label: { en: 'Reset Window Session', ru: 'Сбросить сессию окон' }, description: { en: 'Return to one main window and one Home tab without deleting owner content.', ru: 'Вернуть одно главное окно и одну вкладку Home без удаления данных владельца.' }, keywords: ['reset window layout', 'reset tabs', 'session', 'сброс окон', 'сброс вкладок', 'сессия'], run: (shell, locale) => { shell.resetWindowAndTabLayout({ preserveTabs: false }); shell.setNotice(locale === 'ru' ? 'Сессия окон сброшена: осталось одно главное окно и вкладка Home.' : 'Window session reset to one Home tab.'); } },
  { id: 'keystone.settings.tabs', label: { en: 'Customize tabs', ru: 'Настроить вкладки' }, description: { en: 'Open tab presentation and behavior settings.', ru: 'Открыть настройки вида и поведения вкладок.' }, keywords: ['tabs', 'tab style', 'вкладки'], run: (shell, locale) => shell.openReference({ kind: 'settings', id: 'settings', query: 'tabs', label: locale === 'ru' ? 'Вкладки' : 'Tabs' }, { allowDuplicate: true }) },
  { id: 'keystone.settings.shortcuts', label: { en: 'Customize shortcuts', ru: 'Настроить сочетания клавиш' }, description: { en: 'Edit the registered shell keybindings.', ru: 'Изменить зарегистрированные сочетания shell.' }, keywords: ['shortcut', 'keyboard', 'keybinding', 'сочетания', 'клавиатура'], run: (shell, locale) => shell.openReference({ kind: 'settings', id: 'settings', query: 'shortcuts', label: locale === 'ru' ? 'Сочетания клавиш' : 'Shortcuts' }, { allowDuplicate: true }) },
  { id: 'keystone.settings.advanced', label: { en: 'Open advanced settings', ru: 'Открыть расширенные настройки' }, description: { en: 'Open safe local CSS and settings transfer.', ru: 'Открыть безопасный CSS и перенос настроек.' }, keywords: ['advanced', 'custom css', 'export', 'import', 'расширенные', 'css'], run: (shell, locale) => shell.openReference({ kind: 'settings', id: 'settings', query: 'advanced', label: locale === 'ru' ? 'Расширенные' : 'Advanced' }, { allowDuplicate: true }) },
];

export function createDesktopActionCommands(locale: 'en' | 'ru'): ShellCommand[] {
  return DESKTOP_ACTION_REGISTRY.map(action => ({
    id: action.id,
    label: action.label[locale],
    description: action.description[locale],
    keywords: [...action.keywords],
    run: shell => action.run(shell, locale),
  }));
}
