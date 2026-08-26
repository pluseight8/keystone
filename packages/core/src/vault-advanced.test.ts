import { describe, expect, it } from 'vitest';
import {
  DailyNoteService,
  InMemoryVaultAdvancedStateStore,
  MemoryVaultStorageAdapter,
  VaultBookmarksService,
  VaultQueryParser,
  VaultQueryService,
  VaultQuickSwitcherService,
  VaultService,
  VaultTaskIndexService,
  VaultTemplateService,
} from './index.js';

const owner = 'vault-advanced-owner';
const now = () => Date.parse('2026-08-17T12:00:00.000Z');

function setup() {
  const storage = new MemoryVaultStorageAdapter();
  const vault = new VaultService({ identityId: owner, rootReference: 'local://advanced', name: 'Advanced', storage, now });
  return { storage, vault };
}

describe('Phase 54 advanced personal Vault', () => {
  it('creates deterministic daily notes and keeps calendar/task/activity references in Markdown', async () => {
    const { vault } = setup(); await vault.ready(); const daily = new DailyNoteService(vault, { folder: 'Journal', filenameFormat: 'YYYY-MM-DD.md', template: '# {{date}}' });
    const first = await daily.open('2026-08-17', { calendarRefs: ['calendar:event-1'], taskRefs: ['task-1'], activityRefs: ['live:1'] });
    expect(first.created).toBe(true); expect(first.path).toBe('Journal/2026-08-17.md'); expect(first.note.body).toContain('2026-08-17'); expect(first.note.body).toContain('calendar:event-1');
    expect((await daily.open('2026-08-17')).created).toBe(false); expect((await daily.openPrevious('2026-08-17')).path).toBe('Journal/2026-08-16.md');
  });

  it('expands bounded portable templates without evaluating code', async () => {
    const state = new InMemoryVaultAdvancedStateStore(); const templates = new VaultTemplateService(state, now); await templates.create({ id: 'daily-template', name: 'Daily', content: '# {{date}}\n{{title}}\n{{unknown}}\n{{selectedText}}' });
    const expanded = await templates.expand('daily-template', { date: '2026-08-17', title: 'Trip', selectedText: 'chosen' }); expect(expanded.content).toContain('# 2026-08-17'); expect(expanded.content).toContain('chosen'); expect(expanded.diagnostics).toContain('Unknown template variable: unknown'); expect(expanded.content).not.toContain('eval');
    const restarted = new VaultTemplateService(state, now); expect((await restarted.list()).map(value => value.id)).toEqual(['daily-template']);
  });

  it('persists bookmarks and ranks keyboard-first quick switcher targets', async () => {
    const { vault } = setup(); await vault.ready(); const note = await vault.createNote({ path: 'Projects/Trip.md', content: '# Tokyo plan\n#travel\n## Flights' }); const state = new InMemoryVaultAdvancedStateStore(); const bookmarks = new VaultBookmarksService(state, now); await bookmarks.add({ id: 'trip-bookmark', title: 'Trip', target: { kind: 'note', noteId: note.id }, pinned: true });
    const quick = new VaultQuickSwitcherService(vault); const results = await quick.search('flight', { bookmarks }); expect(results.some(value => value.kind === 'heading')).toBe(true); expect((await bookmarks.list())[0]?.pinned).toBe(true);
  });

  it('indexes Markdown tasks and only converts on explicit request', async () => {
    const { vault } = setup(); await vault.ready(); const note = await vault.createNote({ path: 'Tasks.md', content: '- [ ] Book flight due:2026-08-20 priority:2 #travel\n- [x] Old' }); const tasks = new VaultTaskIndexService(vault); const index = await tasks.build(); expect(index.tasks).toHaveLength(2); expect(index.tasks[0]).toMatchObject({ completed: false, due: '2026-08-20', priority: 2 }); await tasks.toggle(index.tasks[0]!, true); expect((await tasks.build()).tasks[0]?.completed).toBe(true); const converted = await tasks.convertToWorkItem(index.tasks[0]!, { create: async input => ({ id: `work-${input.sourceTaskId}` }) }); expect(converted.id).toContain('work-'); expect((await vault.getNote(note.id))?.body).toContain('keystone-work-item');
  });

  it('parses safe query ASTs, executes bounded table/list queries and mutates board properties through VaultService', async () => {
    const { vault } = setup(); await vault.ready(); const first = await vault.createNote({ path: 'A.md', content: '# Alpha #work', properties: { status: { type: 'string', value: 'todo' }, priority: { type: 'number', value: 2 } } }); await vault.createNote({ path: 'B.md', content: '# Beta #other', properties: { status: { type: 'string', value: 'done' }, priority: { type: 'number', value: 1 } } });
    const parsed = VaultQueryParser.parse('SELECT title, property.status FROM notes WHERE tags CONTAINS work SORT priority desc LIMIT 10'); expect(parsed.source).toBe('notes'); expect(parsed.where?.op).toBe('contains');
    const queries = new VaultQueryService(vault); const result = await queries.execute('SELECT title FROM notes WHERE property.status = todo LIMIT 10'); expect(result.rows).toHaveLength(1); const view = await queries.saveView({ name: 'Board', kind: 'BOARD', query: 'SELECT * FROM notes', boardField: 'property.status' }); await queries.moveBoardCard(view.id, first.id, { type: 'string', value: 'doing' }); expect((await vault.getNote(first.id))?.frontmatter.status?.value).toBe('doing');
    await expect(queries.execute('SELECT * FROM notes LIMIT 1', { maxCost: 1 })).rejects.toMatchObject({ code: 'BOUNDS_EXCEEDED' });
  });
});
