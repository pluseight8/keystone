import { describe, expect, it, vi } from 'vitest';
import {
  DailyLayerService,
  InMemoryDailyLayerStateStore,
  StaticDailyContextSource,
  type DailyContextItem,
  type DailyContextSource,
} from './daily-layer.js';

const NOW = Date.parse('2026-08-23T08:00:00.000Z');
const item = (id: string, overrides: Partial<DailyContextItem> = {}): DailyContextItem => ({
  id,
  sourceType: 'tasks',
  canonicalRef: { id: `object-${id}`, type: 'task', visibility: 'private' },
  title: `Task ${id}`,
  createdAt: new Date(NOW).toISOString(),
  priority: 'completion',
  dataClass: 'PRIVATE',
  ...overrides,
});

function source(sourceType: DailyContextItem['sourceType'], values: readonly DailyContextItem[], extra: Partial<DailyContextSource> = {}): DailyContextSource {
  return { sourceType, sourceId: sourceType, trust: 'core', collect: () => values, ...extra };
}

describe('DailyLayerService', () => {
  it('builds a deterministic factual brief without AI and deduplicates canonical objects', async () => {
    const first = item('task-a', { priority: 'time-sensitive', requiresAction: true, reason: 'Due today' });
    const duplicate = item('message-a', { sourceType: 'messages', canonicalRef: first.canonicalRef, title: 'Same task from notification', priority: 'informational' });
    const service = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', sources: [source('tasks', [first]), source('messages', [duplicate])] });
    const brief = await service.generateBrief({ mode: 'morning', notify: false });
    expect(brief.hasRelevantChanges).toBe(true);
    expect(brief.items).toHaveLength(1);
    expect(brief.items[0]?.title).toBe('Task task-a');
    expect(brief.deterministicText).toContain('Task task-a');
    expect(brief.metrics.consideredCount).toBe(2);
    expect(brief.metrics.deduplicatedCount).toBe(1);
    const again = await service.generateBrief({ mode: 'morning', notify: false });
    expect(again.fingerprint).toBe(brief.fingerprint);
    expect(again.deterministicText).toBe(brief.deterministicText);
  });

  it('isolates source failures/timeouts and bounds source output', async () => {
    const slow: DailyContextSource = { sourceType: 'files', sourceId: 'slow', collect: () => new Promise(resolve => setTimeout(() => resolve([item('late', { sourceType: 'files' })]), 100)) };
    const broken: DailyContextSource = { sourceType: 'devices', sourceId: 'broken', collect: () => { throw new Error('broken'); } };
    const many = Array.from({ length: 400 }, (_, index) => item(`many-${index}`));
    const service = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', sourceTimeoutMs: 25, maxSourceItems: 64, sources: [slow, broken, source('tasks', many)] });
    const brief = await service.generateBrief({ notify: false });
    expect(brief.metrics.timedOutSources).toContain('slow');
    expect(brief.metrics.failedSources).toContain('broken');
    expect(brief.metrics.consideredCount).toBeLessThanOrEqual(64);
    expect(brief.metrics.sourceCount).toBe(1);
  });

  it('respects source toggles, data permissions and locked redaction', async () => {
    const privateItem = item('private', { sourceType: 'messages', canonicalRef: { id: 'secret', type: 'message' }, title: 'Private text' });
    const visible = item('visible', { sourceType: 'tasks', dataClass: 'PUBLIC', canonicalRef: { id: 'public', type: 'task', visibility: 'public' }, priority: 'informational' });
    const service = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', isLocked: () => true, sources: [source('messages', [privateItem]), source('tasks', [visible])] });
    await service.updateSettings({ sources: { messages: false } });
    await service.updateSettings({ frequency: 'moderate' });
    const locked = await service.generateBrief({ notify: false });
    expect(locked.items.map(value => value.id)).toEqual(['visible']);
    expect(locked.items.some(value => value.title === 'Private text')).toBe(false);
    const denied = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', canRead: () => false, sources: [source('messages', [privateItem])] });
    // A host permission check is evaluated before rendering.
    expect((await denied.generateBrief({ notify: false })).items).toHaveLength(0);
  });

  it('supports away coalescing, Continue Context and restart-safe presentation state', async () => {
    const storage = new InMemoryDailyLayerStateStore();
    const service = new DailyLayerService({ ownerId: 'owner', storage, now: () => NOW, timezone: 'UTC', sources: [source('agents', [item('agent-result', { sourceType: 'agents', priority: 'completion', completed: true, continueTarget: true, canonicalRef: { id: 'run-1', type: 'agent-run' } })])] });
    await service.recordActivity({ at: NOW - 60 * 60_000 });
    const brief = await service.generateBrief({ mode: 'morning', notify: false });
    expect(brief.whileYouWereAway?.items.map(value => value.id)).toEqual(['agent-result']);
    expect(brief.continueContext?.canonicalRef.id).toBe('run-1');
    await service.dismiss('agent-result');
    await service.setStartupSurface('workspace', { id: 'board', type: 'workboard' });
    const restarted = new DailyLayerService({ ownerId: 'owner', storage, now: () => NOW, timezone: 'UTC', sources: [source('agents', [item('agent-result', { sourceType: 'agents', priority: 'completion', completed: true, continueTarget: true, canonicalRef: { id: 'run-1', type: 'agent-run' } })])] });
    await restarted.ready();
    expect(restarted.startup().surface).toBe('workspace');
    expect(restarted.resolveStartup({ customTargetExists: () => false }).surface).toBe('home');
    expect((await restarted.generateBrief({ notify: false })).items).toHaveLength(0);
  });

  it('falls back to Home when a custom startup surface has no valid target', async () => {
    const service = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC' });
    await service.setStartupSurface('workspace');
    expect(service.resolveStartup().fallback).toBe(true);
    await service.setStartupSurface('workspace', { id: 'space-1', type: 'workboard' });
    expect(service.resolveStartup({ customTargetExists: () => false })).toMatchObject({ surface: 'home', fallback: true });
  });

  it('persists Continue as a canonical reference without copying private wording', async () => {
    const storage = new InMemoryDailyLayerStateStore();
    const service = new DailyLayerService({ ownerId: 'owner', storage, now: () => NOW, timezone: 'UTC' });
    await service.setContinueContext(item('private-continue', {
      title: 'Private conversation text must not be persisted here',
      summary: 'Private summary must remain in the canonical source',
      canonicalRef: { id: 'private-message', type: 'message', visibility: 'private' },
      dataClass: 'PRIVATE',
    }));
    const persisted = await storage.read() as { continueContext?: Record<string, unknown> };
    expect(persisted.continueContext?.canonicalRef).toEqual({ id: 'private-message', type: 'message', visibility: 'private' });
    expect(persisted.continueContext?.title).toBe('Continue');
    expect(persisted.continueContext?.summary).toBeUndefined();
    expect(JSON.stringify(persisted)).not.toContain('Private conversation text');
    expect(JSON.stringify(persisted)).not.toContain('Private summary');
  });

  it('drops corrupted cursors instead of treating them as source authority', async () => {
    const storage = new InMemoryDailyLayerStateStore();
    await storage.write({ version: 1, settings: {}, startup: {}, cursors: [{ sourceId: '', cursor: 'valid', updatedAt: NOW }, { sourceId: 'tasks', cursor: 'bad cursor', updatedAt: NOW }] });
    const service = new DailyLayerService({ ownerId: 'owner', storage, now: () => NOW, timezone: 'UTC' });
    await service.ready();
    expect(service.stateSnapshot().cursors).toEqual([]);
  });

  it('keeps morning/day/evening/night as modes, not four mandatory notifications', async () => {
    const delivered: string[] = [];
    const service = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', notification: { notify: value => { delivered.push(value.fingerprint); } }, sources: [source('calendar', [item('event', { sourceType: 'calendar', priority: 'time-sensitive', startsAt: new Date(NOW + 30 * 60_000).toISOString(), canonicalRef: { id: 'event-1', type: 'calendar-event' } })])] });
    const modes = await Promise.all((['morning', 'day', 'evening', 'night'] as const).map(mode => service.generateBrief({ mode })));
    expect(modes.map(value => value.mode)).toEqual(['morning', 'day', 'evening', 'night']);
    expect(delivered).toHaveLength(1);
    expect(modes.every(value => value.hasRelevantChanges)).toBe(true);
  });

  it('coalesces notifications and has a valid silent result when nothing is relevant', async () => {
    let count = 0;
    const service = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', notification: { notify: () => { count += 1; } }, sources: [source('feed', [item('noise', { sourceType: 'feed', priority: 'informational' })])] });
    const first = await service.generateBrief({ notify: true });
    const second = await service.generateBrief({ notify: true });
    expect(first.hasRelevantChanges).toBe(false);
    expect(second.items).toHaveLength(0);
    expect(count).toBe(0);
  });

  it('keeps the in-product brief available when the notification boundary rejects', async () => {
    const service = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', notification: { notify: () => { throw new Error('OS permission denied'); } }, sources: [source('tasks', [item('needs-attention', { requiresAction: true })])] });
    const brief = await service.generateBrief({ notify: true });
    expect(brief.items.map(value => value.id)).toEqual(['needs-attention']);
    expect(brief.shouldNotify).toBe(true);
  });

  it('disables only the Daily projection, not canonical source state', async () => {
    const service = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', sources: [source('tasks', [item('task')])] });
    await service.updateSettings({ enabled: false });
    const brief = await service.generateBrief({ notify: true });
    expect(brief.items).toHaveLength(0);
    expect(brief.metrics.sourceCount).toBe(0);
  });

  it('accepts only local/trusted grounded phrasing and falls back on hallucinated facts', async () => {
    const value = item('meeting', { sourceType: 'calendar', priority: 'time-sensitive', factTokens: ['1'], canonicalRef: { id: 'meeting-1', type: 'calendar-event' } });
    const bad = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', phrasing: { privacy: 'LOCAL', phrase: () => ({ text: 'You have 3 meetings', itemIds: ['meeting'] }) }, sources: [source('calendar', [value])] });
    expect((await bad.generateBrief({ notify: false })).phrasedText).toBeUndefined();
    const good = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', phrasing: { privacy: 'LOCAL', phrase: input => ({ text: `One meeting: ${input.items[0]?.title}`, itemIds: ['meeting'] }) }, sources: [source('calendar', [value])] });
    expect((await good.generateBrief({ notify: false })).phrasedText).toContain('One meeting');
    const external = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', phrasing: { privacy: 'EXTERNAL', phrase: vi.fn(() => ({ text: 'leak', itemIds: ['meeting'] })) }, sources: [source('calendar', [value])] });
    expect((await external.generateBrief({ notify: false })).phrasedText).toBeUndefined();
  });

  it('does not let a stalled local phrasing adapter block the deterministic brief', async () => {
    const service = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', phrasingTimeoutMs: 50, phrasing: { privacy: 'LOCAL', phrase: () => new Promise(() => undefined) }, sources: [source('tasks', [item('needs-phrase', { requiresAction: true })])] });
    const started = Date.now();
    const brief = await service.generateBrief({ notify: false });
    expect(Date.now() - started).toBeLessThan(500);
    expect(brief.phrasedText).toBeUndefined();
    expect(brief.deterministicText).toContain('needs-phrase');
  });

  it('rejects plugin priority escalation and requires explicit plugin registration', async () => {
    const plugin: DailyContextSource = { sourceType: 'custom-plugin', trust: 'plugin', collect: () => [item('plugin', { sourceType: 'custom-plugin', priority: 'security', title: '<b>Plugin</b>' })] };
    expect(() => new DailyLayerService({ ownerId: 'owner', sources: [plugin] })).toThrow(/explicit capability/);
    const service = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', allowPluginSources: true, sources: [plugin] });
    await service.updateSettings({ frequency: 'moderate' });
    const brief = await service.generateBrief({ notify: false });
    expect(brief.items[0]?.priority).toBe('informational');
    expect(brief.items[0]?.title).toBe('Plugin');
  });

  it('does not let an untrusted source replace a canonical source registration', () => {
    const canonical = source('calendar', []);
    expect(() => new DailyLayerService({ ownerId: 'owner', allowPluginSources: true, sources: [canonical, { ...canonical, trust: 'plugin', collect: () => [] }] })).toThrow(/replace an owner source/);
  });

  it('does not admit private projections from a remote source without host permission', async () => {
    const remote: DailyContextSource = { sourceType: 'remote-feed', trust: 'remote', collect: () => [item('remote-private', { sourceType: 'remote-feed', dataClass: 'PRIVATE', title: 'Private remote detail' })] };
    const service = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', sources: [remote] });
    expect((await service.generateBrief({ notify: false })).items).toHaveLength(0);
  });

  it('does not import precise coordinates into the daily projection', async () => {
    const location = item('location-share', { sourceType: 'location', priority: 'informational', title: 'latitude 55.751244 longitude 37.618423', summary: 'coordinates: 55.751244,37.618423', canonicalRef: { id: 'share-1', type: 'location-share', visibility: 'private' } });
    const service = new DailyLayerService({ ownerId: 'owner', now: () => NOW, timezone: 'UTC', sources: [source('location', [location])] });
    expect((await service.generateBrief({ notify: false })).items).toHaveLength(0);
    await service.updateSettings({ sources: { location: true }, frequency: 'moderate' });
    const brief = await service.generateBrief({ notify: false });
    expect(brief.deterministicText).not.toMatch(/55\.751244|37\.618423|latitude|longitude|coordinates/i);
    expect(brief.deterministicText).toContain('Location sharing is active');
  });
});
