import { describe, expect, it } from 'vitest';
import {
  DesktopNavigation,
  DesktopShellController,
  DesktopWindowRegistry,
  KeystoneLinkRouter,
  PaneManager,
  TabManager,
  WorkspaceManager,
  createDefaultContextRegistry,
  defaultActivityBar,
  defaultShellCommands,
  defaultPaneTree,
  DESKTOP_WINDOW_REGISTRY_KEY,
  DESKTOP_WINDOW_REGISTRY_QUARANTINE_KEY,
  objectTitle,
  keystoneLinkForReference,
  parseKeystoneLink,
  resolveOmniboxInput,
  tabForReference,
  type DesktopStorage,
} from './desktop-shell-model';

class TestStorage implements DesktopStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('desktop shell tabs and panes', () => {
  it('opens, deduplicates, duplicates, pins, reorders and reopens tabs', () => {
    const first = tabForReference({ kind: 'profile', id: 'bob', label: 'Bob' });
    const tabs = new TabManager([first]);
    expect(tabs.open(tabForReference({ kind: 'profile', id: 'bob', label: 'Bob' })).id).toBe(first.id);
    const duplicate = tabs.duplicate(first.id);
    expect(duplicate?.id).not.toBe(first.id);
    expect(tabs.pin(first.id)).toBe(true);
    expect(tabs.close(first.id)).toBeUndefined();
    expect(tabs.close(duplicate!.id)?.id).toBe(duplicate!.id);
    expect(tabs.reopen()?.id).toBe(duplicate!.id);
    expect(tabs.reorder(duplicate!.id, 0)).toBe(true);
  });

  it('keeps split panes bounded and moves typed tabs without copying objects', () => {
    const root = defaultPaneTree();
    const panes = new PaneManager(root);
    const first = panes.firstPaneId();
    const second = panes.split(first, 'vertical');
    expect(second).toBeTruthy();
    const third = panes.split(second!, 'horizontal');
    expect(third).toBeTruthy();
    expect(panes.split(third!, 'vertical')).toBeUndefined();
    expect(panes.addTab(first, 'tab-profile-bob')).toBe(true);
    expect(panes.moveTab('tab-profile-bob', second!)).toBe(true);
    expect(panes.leaf(second!)?.tabIds).toContain('tab-profile-bob');
  });
});

describe('desktop shell persistence and routing', () => {
  it('starts clean before the first render and is idempotent across repeated initialization', () => {
    const storage = new TestStorage();
    const restored = new DesktopShellController({ storage });
    const music = restored.openReference({ kind: 'music', id: 'music', label: 'Music' });
    restored.openReference({ kind: 'tasks', id: 'tasks', label: 'Tasks' });
    expect(music).toBeTruthy();
    const cleanFirst = new DesktopShellController({ storage, startupMode: 'clean' });
    const cleanSecond = new DesktopShellController({ storage, startupMode: 'clean' });
    cleanFirst.resetWindowAndTabLayout({ preserveTabs: false });
    cleanSecond.resetWindowAndTabLayout({ preserveTabs: false });
    expect(cleanSecond.getSnapshot().workspace.tabs.map(tab => tab.object?.id)).toEqual(['home']);
    expect(cleanSecond.listWindows()).toHaveLength(1);
    expect(cleanSecond.listWindows()[0]?.primary).toBe(true);
  });

  it.each([
    ['legacy version', { version: 1, primaryWindowId: 'main', windows: [{ id: 'main', workspaceId: 'workspace-1', tabIds: ['tab-home'], primary: true }] }],
    ['duplicate tab ownership', { version: 2, primaryWindowId: 'main', windows: [{ id: 'main', workspaceId: 'workspace-1', tabIds: ['tab-home'], primary: true }, { id: 'window-1', workspaceId: 'workspace-1', tabIds: ['tab-home'], primary: false }] }],
    ['empty secondary', { version: 2, primaryWindowId: 'main', windows: [{ id: 'main', workspaceId: 'workspace-1', tabIds: [], primary: true }, { id: 'window-1', workspaceId: 'workspace-1', tabIds: [], primary: false }] }],
    ['impossible geometry', { version: 2, primaryWindowId: 'main', windows: [{ id: 'main', workspaceId: 'workspace-1', tabIds: [], primary: true, geometry: { width: 1, height: 1 } }] }],
  ])('quarantines %s instead of partially recovering it', (_name, fixture) => {
    const storage = new TestStorage();
    storage.setItem(DESKTOP_WINDOW_REGISTRY_KEY, JSON.stringify(fixture));
    const registry = new DesktopWindowRegistry(storage);
    expect(registry.list()).toEqual([]);
    const quarantine = JSON.parse(storage.getItem(DESKTOP_WINDOW_REGISTRY_QUARANTINE_KEY) ?? '{}') as { version?: number; raw?: string };
    expect(quarantine.version).toBe(1);
    expect(quarantine.raw).toContain('workspace-1');
  });

  it('restores a workspace and recovers from corrupted state', () => {
    const storage = new TestStorage();
    const manager = new WorkspaceManager(storage);
    const current = manager.current();
    manager.save({ ...current, name: 'Research', tabs: [...current.tabs, tabForReference({ kind: 'file', id: 'plan', label: 'Plan' })] });
    const restored = new WorkspaceManager(storage).current();
    expect(restored.name).toBe('Research');
    expect(restored.tabs.some(tab => tab.object?.id === 'plan')).toBe(true);
    storage.setItem('keystone.desktop.workspaces.v1', '{not-json');
    expect(new WorkspaceManager(storage).current().tabs.length).toBeGreaterThan(0);
  });

  it('migrates stale session presentation without touching canonical object references', () => {
    const storage = new TestStorage();
    const initial = new DesktopShellController({ storage });
    const workspace = initial.getSnapshot().workspace;
    const music = tabForReference({ kind: 'music', id: 'music', label: 'Music' });
    const duplicateMusic = tabForReference({ kind: 'music', id: 'music', label: 'Music copy' });
    const staleCapture = tabForReference({ kind: 'capture', id: 'capture', label: 'Quick Capture' });
    const stale = { ...workspace, tabs: [workspace.tabs[0], music, duplicateMusic, staleCapture, staleCapture], paneTree: { type: 'leaf' as const, id: 'stale-pane', tabIds: [workspace.tabs[0].id, music.id, duplicateMusic.id, staleCapture.id] } };
    storage.setItem('keystone.desktop.workspaces.v1', JSON.stringify({ version: 1, currentId: workspace.id, workspaces: [stale] }));

    const migrated = new WorkspaceManager(storage).current();
    expect(migrated.tabs.map(tab => tab.object?.kind)).toEqual(['home', 'music']);
    expect(migrated.tabs.filter(tab => tab.object?.kind === 'music' && tab.object.id === 'music')).toHaveLength(1);
    expect(migrated.tabs.some(tab => tab.object?.kind === 'capture' && tab.object.id === 'capture')).toBe(false);
    expect(migrated.tabs.some(tab => tab.object?.kind === 'home' && tab.object.id === 'home')).toBe(true);
  });

  it('does not persist URL credentials or secret parameters', () => {
    const storage = new TestStorage();
    const shell = new DesktopShellController({ storage });
    shell.openBrowser('https://example.test/research?topic=keystone&token=do-not-store#private');
    const raw = storage.values.get('keystone.desktop.workspaces.v1') ?? '';
    expect(raw).not.toContain('do-not-store');
    expect(raw).not.toContain('token');
    expect(raw).toContain('topic=keystone');
  });

  it('keeps browser history separate from Keystone objects and honors permissions', () => {
    const denied = new KeystoneLinkRouter(ref => ref.id !== 'revoked');
    expect(denied.open('keystone://profile/alice').kind).toBe('object');
    expect(denied.open('keystone://profile/revoked').kind).toBe('locked');
    expect(denied.open('https://example.test').kind).toBe('web');
    expect(denied.open('keystone://unknown/a').kind).toBe('invalid');
    expect(resolveOmniboxInput('what changed today?').type).toBe('agent-query');
    expect(resolveOmniboxInput('https://example.test').type).toBe('web');
    expect(resolveOmniboxInput('keystone://chat/bob').type).toBe('object');
    expect(parseKeystoneLink('keystone://home')).toMatchObject({ kind: 'home', id: 'home' });
    expect(parseKeystoneLink('keystone://search')).toMatchObject({ kind: 'settings', id: 'search' });
    expect(parseKeystoneLink('keystone://task/task-1')).toMatchObject({ kind: 'tasks', id: 'task-1' });
    expect(parseKeystoneLink('keystone://conversation/chat-1')).toMatchObject({ kind: 'chat', id: 'chat-1' });
    expect(keystoneLinkForReference({ kind: 'home', id: 'home' })).toBe('keystone://home');
    expect(keystoneLinkForReference({ kind: 'tasks', id: 'task-1' })).toBe('keystone://task/task-1');
    expect(keystoneLinkForReference({ kind: 'chat', id: 'chat-1' })).toBe('keystone://conversation/chat-1');
    expect(parseKeystoneLink('javascript:alert(1)')).toBeUndefined();
    expect(denied.open('keystone://publication/pub-1/revision/sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').ref).toMatchObject({ kind: 'publication', id: 'pub-1', revisionAddress: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(resolveOmniboxInput('vault: security').type).toBe('search');
    expect(denied.open('keystone://vault/vault-a/note/note-a').ref).toMatchObject({ kind: 'vault', id: 'note-a', vaultId: 'vault-a' });
    expect(denied.open('keystone://vault/vault-a/graph').ref).toMatchObject({ kind: 'graph', id: 'vault-a', vaultId: 'vault-a' });
    expect(denied.open('keystone://vault/vault-a/canvas/canvas-a').ref).toMatchObject({ kind: 'canvas', id: 'canvas-a', vaultId: 'vault-a' });
    expect(defaultShellCommands('en').some(command => command.id === 'open-vault')).toBe(true);
    expect(defaultShellCommands('en').some(command => command.id === 'open-capture')).toBe(true);
    expect(defaultShellCommands('en').some(command => command.id === 'open-vault-graph')).toBe(true);
    expect(defaultShellCommands('en').filter(command => command.id === 'open-mail')).toHaveLength(1);
    expect(defaultShellCommands('en').filter(command => command.id === 'compose-mail')).toHaveLength(1);
    expect(defaultActivityBar().find(item => item.id === 'mail')?.kind).toBe('mail');
    expect(defaultActivityBar().find(item => item.id === 'capture')?.kind).toBe('capture');
    expect(defaultActivityBar().find(item => item.id === 'capture')?.icon).toBe('capture');
    expect(defaultActivityBar().find(item => item.id === 'tasks')?.icon).toBe('task');
    expect(defaultActivityBar().filter(item => item.visible).map(item => item.id)).toEqual(expect.arrayContaining(['home', 'search', 'music', 'video', 'capture', 'tasks', 'document', 'settings']));
    expect(defaultActivityBar().filter(item => item.visible).map(item => item.id)).not.toEqual(expect.arrayContaining(['shorts', 'ai', 'network', 'device']));
    expect(defaultShellCommands('en').map(command => command.id)).toEqual(expect.arrayContaining(['open-music', 'open-video', 'open-shorts', 'open-ai', 'open-connectivity']));
    expect(objectTitle({ kind: 'network', id: 'network' })).toBe('Connectivity');
  });

  it('supports navigation back/forward without duplicating entries', () => {
    const history = new DesktopNavigation();
    history.push({ title: 'Home', ref: { kind: 'home', id: 'home' } });
    history.push({ title: 'Bob', ref: { kind: 'profile', id: 'bob' } });
    history.push({ title: 'Bob', ref: { kind: 'profile', id: 'bob' } });
    expect(history.list()).toHaveLength(2);
    expect(history.back()?.ref?.id).toBe('home');
    expect(history.forward()?.ref?.id).toBe('bob');
  });
});

describe('desktop shell integrations', () => {
  it('uses typed context providers and customizable activity items', () => {
    const registry = createDefaultContextRegistry('en');
    const data = registry.resolve({ kind: 'chat', id: 'chat-bob' });
    expect(data.sections.some(section => section.id === 'properties')).toBe(true);
    const activity = defaultActivityBar();
    expect(activity.find(item => item.id === 'plugins')?.extensionSlot).toBe(true);
  });

  it('opens one object reference across panes and persists a workspace switch', () => {
    const storage = new TestStorage();
    const shell = new DesktopShellController({ storage });
    const profile = shell.openReference({ kind: 'profile', id: 'bob', label: 'Bob' });
    expect(profile?.object?.id).toBe('bob');
    shell.splitPane('vertical');
    const workspace = shell.listWorkspaces()[0];
    shell.createWorkspace('Planning');
    expect(shell.getSnapshot().workspace.name).toBe('Planning');
    shell.switchWorkspace(workspace.id);
    expect(shell.getSnapshot().workspace.name).not.toBe('Planning');
    expect(shell.getSnapshot().workspace.tabs.some(tab => tab.object?.id === 'bob')).toBe(true);
  });

  it('resets window and tab presentation without deleting owner content', () => {
    const storage = new TestStorage();
    const shell = new DesktopShellController({ storage, windowBridge: { open: () => true, focus: () => undefined, close: () => undefined, closeSelf: () => undefined } });
    const music = shell.openReference({ kind: 'music', id: 'music', label: 'Music' });
    shell.openReference({ kind: 'tasks', id: 'tasks', label: 'Tasks' });
    shell.splitPane('vertical');
    shell.toggleAgentPanel(true);
    expect(shell.listWindows()).toHaveLength(1);
    expect(shell.resetWindowAndTabLayout()).toBe(true);
    expect(shell.listWindows()).toHaveLength(1);
    expect(shell.getSnapshot().workspace.tabs.map(tab => tab.object?.id)).toEqual(['home', 'music', 'tasks']);
    expect(shell.getSnapshot().workspace.paneTree.type).toBe('leaf');
    expect(shell.getSnapshot().workspace.chrome.contextSidebarOpen).toBe(false);
    expect(shell.getSnapshot().workspace.chrome.agentPanelOpen).toBe(false);
    const restarted = new DesktopShellController({ storage });
    expect(restarted.getSnapshot().workspace.tabs.some(tab => tab.object?.id === music?.object?.id)).toBe(true);
    expect(restarted.listWindows()).toHaveLength(1);
  });

  it('can apply a fresh-tab session policy while retaining closed references for explicit reopen', () => {
    const storage = new TestStorage();
    const shell = new DesktopShellController({ storage });
    const music = shell.openReference({ kind: 'music', id: 'music', label: 'Music' });
    expect(music).toBeTruthy();
    shell.resetWindowAndTabLayout({ preserveTabs: false });
    expect(shell.getSnapshot().workspace.tabs.map(tab => tab.object?.id)).toEqual(['home']);
    expect(shell.getSnapshot().workspace.closedTabs.some(tab => tab.object?.id === 'music')).toBe(true);
    expect(new DesktopShellController({ storage }).getSnapshot().workspace.tabs.map(tab => tab.object?.id)).toEqual(['home']);
  });

  it('closes only unpinned tabs when the tab context menu requests other tabs', () => {
    const shell = new DesktopShellController({ storage: new TestStorage() });
    const home = shell.currentTab!;
    const first = shell.openReference({ kind: 'tasks', id: 'first', label: 'First' }, { allowDuplicate: true });
    const second = shell.openReference({ kind: 'document', id: 'second', label: 'Second' }, { allowDuplicate: true });
    shell.pinTab(first!.id);
    shell.closeOtherTabs(second!.id);
    const tabs = shell.getSnapshot().workspace.tabs;
    expect(tabs.some(tab => tab.id === second!.id)).toBe(true);
    expect(tabs.some(tab => tab.id === first!.id)).toBe(true);
    expect(tabs.some(tab => tab.id === home.id)).toBe(true);
  });

  it('covers the desktop integration journey and survives a fresh controller', () => {
    const storage = new TestStorage();
    const shell = new DesktopShellController({ storage });
    shell.openReference({ kind: 'profile', id: 'bob', label: 'Bob' });
    shell.openReference({ kind: 'chat', id: 'chat-bob', label: 'Chat · Bob' });
    shell.splitPane('vertical');
    shell.openReference({ kind: 'file', id: 'trip-plan', label: 'Trip plan.pdf' });
    shell.toggleAgentPanel(true);
    shell.createWorkspace('Research');
    shell.switchWorkspace(shell.listWorkspaces()[0].id);
    const restarted = new DesktopShellController({ storage });
    const restored = restarted.getSnapshot();
    expect(restored.workspace.tabs.some(tab => tab.object?.id === 'bob')).toBe(true);
    expect(restored.workspace.tabs.some(tab => tab.object?.id === 'trip-plan')).toBe(true);
    expect(restored.workspace.paneTree.type).toBe('split');
  });

  it('locks a restored object when the permission callback is revoked', () => {
    const storage = new TestStorage();
    const allowed = new DesktopShellController({ storage, canOpen: () => true });
    allowed.openReference({ kind: 'file', id: 'private-plan', label: 'Private plan', visibility: 'private' });
    const revoked = new DesktopShellController({ storage, canOpen: ref => ref.id !== 'private-plan' });
    expect(revoked.getSnapshot().workspace.tabs.find(tab => tab.object?.id === 'private-plan')?.locked).toBe(true);
  });

  it('keeps browser page scope bounded, non-secret and restorable with the workspace tab', () => {
    const storage = new TestStorage();
    const shell = new DesktopShellController({ storage });
    const tab = shell.openBrowserSession('https://example.test/article?token=secret', 'browser-session-1', 'Research');
    expect(tab?.browserSessionId).toBe('browser-session-1');
    shell.setBrowserState(tab!.id, { sessionId: 'browser-session-1', activity: 'OBSERVING', page: { tabId: tab!.id, url: 'https://example.test/article?token=secret', origin: 'https://example.test', title: 'Article', pageRevision: 4, dataClass: 'PUBLIC', visibleText: 'bounded page text', interactiveCount: 3 } });
    const raw = storage.values.get('keystone.desktop.workspaces.v1') ?? '';
    expect(raw).not.toContain('bounded page text');
    expect(raw).not.toContain('token=secret');
    expect(shell.browserPage(tab!.id)?.pageRevision).toBe(4);
    const restarted = new DesktopShellController({ storage });
    const restored = restarted.getSnapshot().workspace.tabs.find(candidate => candidate.id === tab!.id);
    expect(restored?.browserSessionId).toBe('browser-session-1');
    expect(restored?.browserPageRevision).toBe(4);
    expect(createDefaultContextRegistry('en').resolve(undefined, restarted.browserPage(tab!.id)).sections.some(section => section.id === 'browser-scope')).toBe(true);
    restarted.applyBrowserActionResult(tab!.id, { sessionId: 'browser-session-1', status: 'NEEDS_CONFIRMATION' });
    expect(restarted.browserState(tab!.id)?.activity).toBe('NEEDS_CONFIRMATION');
  });

  it('restores a selected startup surface without forcing Home and safely falls back', () => {
    const storage = new TestStorage();
    const first = new DesktopShellController({ storage });
    first.setStartupSurface('messages');
    const restarted = new DesktopShellController({ storage });
    expect(restarted.startupSurface().surface).toBe('messages');
    expect(restarted.currentTab?.kind).toBe('chat');
    restarted.setStartupSurface('workspace', { kind: 'workboard', id: 'missing-workboard' });
    const safe = new DesktopShellController({ storage });
    expect(safe.startupSurface().surface).toBe('workspace');
    // Hosts may validate custom targets before opening them; shell remains usable.
    expect(safe.currentTab).toBeTruthy();
  });

  it('falls back to Home when a custom startup target is no longer authorized', () => {
    const storage = new TestStorage();
    const first = new DesktopShellController({ storage });
    first.setStartupSurface('workspace', { kind: 'workboard', id: 'revoked-board', label: 'Revoked board' });
    const restarted = new DesktopShellController({ storage, canOpen: reference => reference.id !== 'revoked-board' });
    expect(restarted.currentTab?.object?.kind).toBe('home');
    expect(restarted.startupSurface().surface).toBe('workspace');
  });
});

describe('cross-window tab ownership', () => {
  it('redocks at the requested insertion index and restores one owner after restart', async () => {
    const storage = new TestStorage();
    const bridge = { open: () => true, focus: () => undefined, closeSelf: () => undefined };
    const primary = new DesktopShellController({ storage, windowBridge: bridge });
    const tasks = primary.openReference({ kind: 'tasks', id: 'tasks', label: 'Tasks' });
    const music = primary.openReference({ kind: 'music', id: 'music', label: 'Music' });
    expect(tasks && music).toBeTruthy();
    expect(await primary.openTabInNewWindow(music!.id)).toBe(true);
    const detached = primary.listWindows().find(window => !window.primary);
    expect(detached).toBeTruthy();
    const child = new DesktopShellController({ storage, windowId: detached!.id, detachedTabId: music!.id, windowBridge: bridge });
    expect(child.getSnapshot().workspace.tabs.map(tab => tab.id)).toEqual([music!.id]);

    expect(child.transferTabToWindowAt(music!.id, primary.windowId, 1, 'physical-redock')).toBe(true);
    const registry = new DesktopWindowRegistry(storage);
    expect(registry.ownerOf(primary.getSnapshot().workspace.id, music!.id)?.id).toBe(primary.windowId);
    expect(registry.list(primary.getSnapshot().workspace.id).flatMap(window => window.tabIds).filter(tabId => tabId === music!.id)).toHaveLength(1);
    expect(registry.list(primary.getSnapshot().workspace.id).some(window => window.id === detached!.id)).toBe(false);

    const restarted = new DesktopShellController({ storage, windowId: primary.windowId });
    expect(restarted.getSnapshot().workspace.tabs.map(tab => tab.id)).toEqual([primary.getSnapshot().workspace.tabs[0]?.id, music!.id, tasks!.id]);
  });

  it('closes a stale secondary controller after another window accepts its tab', async () => {
    const storage = new TestStorage();
    const closeCalls: string[] = [];
    const bridge = { open: () => true, focus: () => undefined, closeSelf: () => { closeCalls.push('closed'); } };
    const primary = new DesktopShellController({ storage, windowBridge: bridge });
    const music = primary.openReference({ kind: 'music', id: 'music', label: 'Music' });
    expect(music).toBeTruthy();
    expect(await primary.openTabInNewWindow(music!.id)).toBe(true);
    const detached = primary.listWindows().find(window => !window.primary);
    expect(detached).toBeTruthy();
    const child = new DesktopShellController({ storage, windowId: detached!.id, detachedTabId: music!.id, windowBridge: bridge });
    expect(child.currentTab?.id).toBe(music!.id);

    expect(primary.acceptWindowTransfer({
      type: 'start',
      transactionId: 'physical-redock-refresh',
      workspaceId: primary.getSnapshot().workspace.id,
      sourceWindowId: child.windowId,
      tabId: music!.id,
      sourceIndex: 0,
      tab: child.currentTab!,
    }, 1)).toBe(true);
    child.refreshFromStorage();
    expect(child.getSnapshot().workspace.tabs).toHaveLength(0);
    expect(closeCalls).toContain('closed');
    expect(new DesktopWindowRegistry(storage).get(detached!.id)).toBeUndefined();
  });

  it('keeps an unregistered secondary isolated until its registry record arrives', () => {
    const storage = new TestStorage();
    const closed: string[] = [];
    const primary = new DesktopShellController({ storage });
    primary.openReference({ kind: 'music', id: 'music', label: 'Music' });
    const child = new DesktopShellController({
      storage,
      windowId: 'window-arriving-late',
      windowBridge: { open: () => true, focus: () => undefined, closeSelf: () => { closed.push('secondary'); } },
    });

    expect(child.windowId).toBe('window-arriving-late');
    expect(child.isPrimaryWindow).toBe(false);
    expect(child.getSnapshot().workspace.tabs).toHaveLength(0);

    child.refreshFromStorage();
    expect(child.getSnapshot().workspace.tabs).toHaveLength(0);
    expect(closed).toEqual(['secondary']);
  });

  it('rejects a stale transfer and merges a secondary window without duplicate ownership', () => {
    const storage = new TestStorage();
    const shell = new DesktopShellController({ storage });
    const first = shell.openReference({ kind: 'music', id: 'music', label: 'Music' });
    const second = shell.openReference({ kind: 'video', id: 'video', label: 'Video' });
    expect(first && second).toBeTruthy();
    const registry = new DesktopWindowRegistry(storage);
    const detached = registry.createDetached(shell.getSnapshot().workspace.id, first!.id);
    expect(detached).toBeTruthy();
    expect(registry.transferTabAt(shell.getSnapshot().workspace.id, first!.id, detached!.id, 'main', 1)).toBeTruthy();
    expect(registry.transferTabAt(shell.getSnapshot().workspace.id, first!.id, detached!.id, 'main', 1)).toBeUndefined();
    const secondWindow = registry.createDetached(shell.getSnapshot().workspace.id, second!.id);
    expect(secondWindow).toBeTruthy();
    expect(registry.transferAllAt(shell.getSnapshot().workspace.id, secondWindow!.id, 'main')).toBe(true);
    const owned = registry.list(shell.getSnapshot().workspace.id).flatMap(window => window.tabIds);
    expect(owned.filter(tabId => tabId === second!.id)).toHaveLength(1);
    expect(registry.get(secondWindow!.id)).toBeTruthy();
  });
});
