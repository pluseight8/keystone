import { describe, expect, it, vi } from 'vitest';
import { ResourceManager, type BatteryProvider, type BatteryState } from './resource-manager.js';

describe('ResourceManager', () => {
  it('pauses expensive work off charger and restores it when power is safe', async () => {
    let notify: ((state: BatteryState) => void) | undefined;
    const battery: BatteryProvider = {
      getState: async () => ({ level: .8, charging: false }),
      subscribe: listener => { notify = listener; return () => { notify = undefined; }; },
    };
    const indexer = { pause: vi.fn(), resume: vi.fn() };
    const chronos = { setIntervalMultiplier: vi.fn() };
    const manager = new ResourceManager({ battery, indexer, chronos });

    await manager.start();
    expect(manager.getState().ecoMode).toBe(true);
    expect(indexer.pause).toHaveBeenCalledOnce();
    expect(chronos.setIntervalMultiplier).toHaveBeenLastCalledWith(3);

    notify?.({ level: .65, charging: true });
    expect(manager.getState().ecoMode).toBe(false);
    expect(indexer.resume).toHaveBeenCalledOnce();
    expect(chronos.setIntervalMultiplier).toHaveBeenLastCalledWith(1);
  });

  it('uses eco mode below 20 percent even while charging', async () => {
    const manager = new ResourceManager({ battery: { getState: async () => ({ level: .19, charging: true }) }, indexer: { pause: vi.fn(), resume: vi.fn() }, chronos: { setIntervalMultiplier: vi.fn() } });
    await manager.start();
    expect(manager.getState().ecoMode).toBe(true);
  });
});
