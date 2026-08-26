import { describe, expect, it } from 'vitest';
import { CAPTURE_MAX_ITEMS, CaptureService } from '../capture.js';

describe('R0P94 bounded scale', () => {
  it('indexes and paginates 10,000 metadata-only captures without per-item timers', async () => {
    const service = new CaptureService({ maxItems: CAPTURE_MAX_ITEMS });
    for (let offset = 0; offset < 10; offset += 1) await service.captureBulk(Array.from({ length: 1_000 }, (_, index) => ({ kind: 'TEXT' as const, text: `scale-${offset}-${index}` })));
    const page = await service.list({ query: 'scale-', limit: 200 });
    expect(page.total).toBe(10_000);
    expect(page.items).toHaveLength(200);
    expect(service.diagnostics()).toMatchObject({ items: 10_000, timers: 0, listeners: 0 });
  }, 180_000);
});
