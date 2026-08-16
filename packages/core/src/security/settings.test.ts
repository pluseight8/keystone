import { describe, expect, it } from 'vitest';
import { InMemorySettingsStorage, SettingsService } from './settings.js';

describe('local Settings Center state', () => {
  it('persists validated settings and applies live bindings', async () => {
    const storage = new InMemorySettingsStorage(); const settings = new SettingsService(storage); const calls: string[] = [];
    await settings.bind({ setOfflineMode: value => { calls.push(`offline:${value}`); }, setMaxParallelTransfers: value => { calls.push(`parallel:${value}`); }, setDiscoveryParticipation: value => { calls.push(`discovery:${value}`); }, setLocalHistory: value => { calls.push(`history:${value}`); }, setAIOrchestrationMode: value => { calls.push(`ai:${value}`); } });
    await settings.update({ privacy: { discoveryParticipation: false, localHistory: false }, network: { offlineMode: true, maxParallelTransfers: 1 }, ai: { orchestrationMode: 'local-preferred' } });
    expect(settings.snapshot().privacy.discoveryParticipation).toBe(false); expect(settings.snapshot().network.offlineMode).toBe(true); expect(settings.snapshot().ai.orchestrationMode).toBe('local-preferred'); expect(calls).toContain('offline:true'); expect(calls).toContain('parallel:1'); expect(calls).toContain('discovery:false'); expect(calls).toContain('ai:local-preferred');
    const restarted = new SettingsService(storage); await restarted.ready(); expect(restarted.snapshot().privacy.localHistory).toBe(false); expect(restarted.snapshot().network.maxParallelTransfers).toBe(1);
  });
});
