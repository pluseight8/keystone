import { describe, expect, it } from 'vitest';
import {
  FeedFetchClient,
  FeedRefreshScheduler,
  SubscriptionService,
  type FeedHttpRequest,
  type FeedHttpResponse,
} from '../subscriptions.js';

class ScaleTransport {
  requests = 0;
  constructor(private readonly body: string) {}
  async request(_input: FeedHttpRequest): Promise<FeedHttpResponse> { this.requests += 1; return { status: 200, url: 'https://scale.example.test/feed.xml', headers: { 'content-type': 'application/rss+xml' }, body: this.body }; }
}

function makeFeed(count: number): string {
  const items = Array.from({ length: count }, (_, index) => `<item><guid>scale-${index}</guid><title>Scale item ${index}</title><link>https://scale.example.test/items/${index}</link><description>Bounded content ${index}</description></item>`).join('');
  return `<rss version="2.0"><channel><title>Scale feed</title><link>https://scale.example.test/</link>${items}</channel></rss>`;
}

describe('R0P89 subscriptions scale bounds', () => {
  it('parses, retains, paginates and searches a bounded 1,000-item feed', async () => {
    const transport = new ScaleTransport(makeFeed(1_000));
    const service = new SubscriptionService({ feedClient: new FeedFetchClient(transport), maxEntriesPerFeed: 1_000, maxEntries: 1_000 });
    const subscription = await service.subscribe({ url: 'https://scale.example.test/feed.xml', ownerConfirmed: true });
    const refreshed = await service.refresh(subscription.id);
    expect(refreshed.status).toBe('UPDATED');
    expect(service.diagnostics()).toMatchObject({ subscriptions: 1, entries: 1_000, unread: 0, activeRefreshes: 0 });
    const first = await service.listEntries({ limit: 128 });
    expect(first.items).toHaveLength(128);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.listEntries({ limit: 128, cursor: first.nextCursor });
    expect(second.items).toHaveLength(128);
    expect((await service.search('scale item 999')).map(value => value.entry.title)).toContain('Scale item 999');
    expect(transport.requests).toBe(1);
  }, 60_000);

  it('uses one bounded scheduler wake point rather than one timer per subscription', async () => {
    const service = new SubscriptionService({ maxSubscriptions: 256 });
    for (let index = 0; index < 256; index += 1) await service.subscribe({ url: `https://feeds.example.test/${index}.xml`, ownerConfirmed: true });
    const scheduler = new FeedRefreshScheduler(service);
    expect(await scheduler.nextWakeAt(Date.now())).toBeTypeOf('number');
    expect(service.diagnostics().activeRefreshes).toBe(0);
  }, 60_000);
});
