import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTINUITY_MAX_HANDOFF_BYTES, CONTINUITY_MAX_PENDING_HANDOFFS, ContinuityService } from './continuity.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('R0P84 Continuity architecture guards', () => {
  it('keeps Continuity above the PersonalDeviceMesh and Connectivity boundaries', () => {
    const source = readFileSync(join(here, 'continuity.ts'), 'utf8');
    expect(source).toMatch(/PersonalDeviceMesh|ContinuityTrustAuthority/);
    expect(source).toMatch(/KeystoneDeliveryInterface/);
    expect(source).not.toMatch(/(?:hyperswarm|hyperdht|@keystone\/native-host|new\s+(?:Hyperswarm|DHT)|navigator\.bluetooth|navigator\.geolocation)/i);
    expect(source).not.toMatch(/from ['"]\.\/transport\.js['"]/);
    expect(source).not.toMatch(/fetch\s*\(|WebSocket\s*\(|navigator\.onLine/);
  });

  it('keeps references bounded and clipboard opt-in at the service boundary', () => {
    const source = readFileSync(join(here, 'continuity.ts'), 'utf8');
    expect(CONTINUITY_MAX_HANDOFF_BYTES).toBe(256 * 1024);
    expect(CONTINUITY_MAX_PENDING_HANDOFFS).toBe(256);
    expect(source).toContain('automaticClipboardEnabled: false');
    expect(source).toContain('owner confirmation');
    expect(source).toContain('CONTINUITY_MAX_WORKSPACE_TABS');
    expect(source).toContain('CONTINUITY_MAX_VIEW_CONTEXT_BYTES');
    expect(ContinuityService).toBeDefined();
  });

  it('does not expose transport or credential seams through the host-neutral adapter API', () => {
    const source = readFileSync(join(here, 'continuity.ts'), 'utf8');
    expect(source).not.toMatch(/(?:shell|command|executable|script|apiKey|credential|cookie|sessionToken)\s*:/i);
    expect(source).toMatch(/contentId|DistributedContent|CAN_RECEIVE_FILES/);
    expect(source).toMatch(/openOnTarget/);
  });
});
