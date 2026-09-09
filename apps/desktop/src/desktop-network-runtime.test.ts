import { describe, expect, it } from 'vitest';
import { createDesktopNetworkRuntime } from './desktop-network-runtime';

describe('desktop connectivity runtime', () => {
  it('reports honest device-only state when no host provider is installed', () => {
    const runtime = createDesktopNetworkRuntime();
    expect(runtime.snapshot()).toMatchObject({ state: 'DEVICE_ONLY', availableProviders: [] });
    expect(runtime.configuration().providers).toEqual([]);
  });
});
