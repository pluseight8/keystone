import { it } from 'vitest';
import { DeviceRuntimeService, PhysicalFeatureProbe } from './index.js';

it('R0P66 evidence report (manual capture)', async () => {
  const evidence = await new PhysicalFeatureProbe('linux').all();
  for (const item of evidence) console.log(`R0P66_EVIDENCE ${item.feature} status=${item.status} class=${item.classification} statuses=${item.evidence.statuses.join(',')}`);
  const runtime = await new DeviceRuntimeService({ platform: 'linux' }).start();
  console.log(`R0P66_RUNTIME id=${runtime.id} recovery=${runtime.recovery} network=${runtime.network.state} local=${runtime.network.localNetworkAvailable}`);
});
