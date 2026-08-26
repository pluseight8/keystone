import { describe, expect, it } from 'vitest';
import { UniversalInboxService, createCanonicalInboxAdapter, type InboxAdapterEvent, type InboxSourceProjection } from '../inbox.js';

describe('R0P88 Inbox scale bounds', () => {
  it('handles 100k metadata projections, burst coalescing, search and pagination without per-item timers', async () => {
    const total = 100_000;
    const values: InboxSourceProjection[] = Array.from({ length: total }, (_, index) => ({ source: { source: 'web', id: `archive-${index}`, archiveId: `archive-${index}` }, kind: 'SYSTEM_ATTENTION', sourceVersion: '1', presentation: { title: `Saved item ${index}`, snippet: index % 2 ? 'read later' : 'offline archive', receivedAt: new Date(1_700_000_000_000 + index).toISOString(), updatedAt: new Date(1_700_000_000_000 + index).toISOString(), reasons: ['bounded metadata'], priority: 'informational', requiresAction: false, dataClass: 'public' }, actions: [{ id: 'open' as never, kind: 'OPEN_SOURCE', label: 'Open', requiresOwnerConfirmation: false, sourceVersion: '1' }] }));
    let listener: ((event: InboxAdapterEvent<InboxSourceProjection>) => void) | undefined;
    const adapter = createCanonicalInboxAdapter({ sourceKind: 'web', trust: 'CORE', list: input => values.slice(0, input.limit), subscribe: next => { listener = next; return () => { listener = undefined; }; } });
    const inbox = new UniversalInboxService({ adapters: [adapter], maxItems: total, hydrationLimit: 128 });
    await inbox.ready();
    for (const value of values) listener!({ kind: 'UPSERT', source: value });
    await inbox.flush();
    expect(inbox.diagnostics().itemCount).toBe(total);
    expect(inbox.diagnostics().snoozeWakeIndexSize).toBe(0);
    expect((await inbox.list({ limit: 128 })).items).toHaveLength(128);
    expect((await inbox.search('99999', { limit: 8 })).items[0]!.presentation.title).toBe('Saved item 99999');
    expect((await inbox.list({ groupKey: 'missing', limit: 8 })).items).toHaveLength(0);
  }, 180_000);
});
