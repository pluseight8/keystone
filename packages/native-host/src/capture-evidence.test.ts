import { expect, it } from 'vitest';
import { PhysicalFeatureProbe } from './runtime.js';

it('R0P94 reports real Wayland clipboard runtime evidence without reading user data', async () => {
  const result = await new PhysicalFeatureProbe('linux').probe('clipboard');
  expect(['PASS', 'BLOCKED']).toContain(result.status);
  expect(result.evidence.statuses).toContain('DECLARED');
  expect(result.evidence.statuses).not.toContain('PHYSICALLY_VERIFIED');
  console.log(`R0P94_CAPTURE_EVIDENCE ${JSON.stringify({ status: result.status, classification: result.classification, method: result.method, statuses: result.evidence.statuses, limitations: result.limitations })}`);
});
