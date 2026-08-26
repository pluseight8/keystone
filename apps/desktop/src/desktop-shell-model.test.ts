import { describe, expect, it } from 'vitest';
import {
  DesktopNavigation,
  DesktopShellController,
  KeystoneLinkRouter,
  PaneManager,
  TabManager,
  WorkspaceManager,
  createDefaultContextRegistry,
  defaultActivityBar,
  defaultShellCommands,
  defaultPaneTree,
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
