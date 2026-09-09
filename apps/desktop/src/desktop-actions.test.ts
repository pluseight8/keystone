import { describe, expect, it } from 'vitest';
import { createDesktopActionCommands, DESKTOP_ACTION_REGISTRY } from './desktop-actions';
import type { DesktopShellController } from './desktop-shell-model';

describe('desktop action registry', () => {
  it('contains unique localized shell actions', () => {
    const ids = DESKTOP_ACTION_REGISTRY.map(action => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('keystone.quit');
    expect(ids).toContain('keystone.session.reset-layout');
    expect(createDesktopActionCommands('en').map(command => command.id)).toEqual(ids);
    expect(createDesktopActionCommands('ru').every(command => command.label.length > 0)).toBe(true);
  });

  it('routes the recovery action to one Home tab without deleting owner content', () => {
    const calls: unknown[] = [];
    const shell = {
      resetWindowAndTabLayout: (options: unknown) => calls.push(options),
      setNotice: (notice: string) => calls.push(notice),
    } as unknown as DesktopShellController;
    const action = DESKTOP_ACTION_REGISTRY.find(candidate => candidate.id === 'keystone.session.reset-layout');
    expect(action).toBeTruthy();
    action!.run(shell, 'ru');
    expect(calls[0]).toEqual({ preserveTabs: false });
    expect(calls[1]).toContain('одно главное окно');
  });
});
