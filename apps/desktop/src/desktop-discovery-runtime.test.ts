import { describe, expect, it } from 'vitest';
import { PersistentDiscoveryStorage, UnifiedDiscoveryService } from '@keystone/core';
import { createDesktopDiscoveryRuntime } from './desktop-discovery-runtime';

class StateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

describe('desktop discovery runtime', () => {
  it('uses the real local discovery service and starts empty', async () => {
    const service = new UnifiedDiscoveryService({ storage: new PersistentDiscoveryStorage(new StateStore()) });
    const runtime = createDesktopDiscoveryRuntime(service);
    await service.ready();
    expect(await runtime.counts()).toEqual({ indexed: 0, following: 0, communities: 0 });
    expect((await runtime.search('nothing')).items).toHaveLength(0);
    expect((await runtime.feed('home')).items).toHaveLength(0);
  });
});
