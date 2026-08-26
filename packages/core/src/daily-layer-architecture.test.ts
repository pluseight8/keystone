import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Daily Layer architecture boundary', () => {
  it('stays a bounded projection and cannot become a transport or polling surface', () => {
    const source = readFileSync(new URL('./daily-layer.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"].*transport/);
    expect(source).not.toMatch(/from ['"].*connectivity/);
    expect(source).not.toMatch(/ConnectivityFabric|KeystoneDeliveryInterface/);
    expect(source).not.toMatch(/setInterval\s*\(/);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).toMatch(/InMemoryDailyLayerStateStore/);
    expect(source).toMatch(/MAX_SOURCE_ITEMS|sourceTimeoutMs/);
  });
});
