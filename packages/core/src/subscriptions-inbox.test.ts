import { describe, expect, it } from 'vitest';
import { UniversalInboxService } from './inbox.js';
import {
  FeedFetchClient,
  InMemorySubscriptionStateStore,
  SubscriptionService,
  createSubscriptionsInboxAdapter,
  type FeedHttpRequest,
  type FeedHttpResponse,
} from './subscriptions.js';

class InboxFeedTransport {
  private index = 0;
  constructor(private readonly bodies: readonly string[]) {}
  async request(_input: FeedHttpRequest): Promise<FeedHttpResponse> { const body = this.bodies[Math.min(this.index++, this.bodies.length - 1)]!; return { status: 200, url: 'https://example.test/feed.xml', headers: { 'content-type': 'application/rss+xml' }, body }; }
}

const feed = (guid: string, title: string): string => `<rss><channel><title>Inbox feed</title><item><guid>${guid}</guid><title>${title}</title><link>https://example.test/${guid}</link><description>New feed material</description></item></channel></rss>`;

describe('R0P89 optional Universal Inbox projection', () => {
  it('projects only owner-enabled unread items with a subscriptions source badge', async () => {
    const service = new SubscriptionService({ feedClient: new FeedFetchClient(new InboxFeedTransport([feed('one', 'Baseline'), feed('two', 'Attention')])), stateStore: new InMemorySubscriptionStateStore() });
    const subscription = await service.subscribe({ url: 'https://example.test/feed.xml', ownerConfirmed: true, notifyOnNewItems: true });
    await service.refresh(subscription.id);
    await service.refresh(subscription.id);
    const inbox = new UniversalInboxService({ adapters: [createSubscriptionsInboxAdapter(service)] });
    await inbox.ready();
    const result = await inbox.list({ sourceKind: 'subscriptions', view: 'UNREAD' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ sourceKind: 'subscriptions', kind: 'FEED_ITEM', source: { source: 'subscriptions', entryId: expect.any(String) } });
    expect(result.items[0]?.actions[0]?.kind).toBe('OPEN_SUBSCRIPTION');
    await inbox.executeAction({ itemId: result.items[0]!.id, action: 'OPEN_SUBSCRIPTION', ownerConfirmed: true });
  });

  it('does not flood Inbox when notification policy is disabled', async () => {
    const service = new SubscriptionService({ feedClient: new FeedFetchClient(new InboxFeedTransport([feed('one', 'Baseline'), feed('two', 'No notification')])), stateStore: new InMemorySubscriptionStateStore() });
    const subscription = await service.subscribe({ url: 'https://example.test/no-notify.xml', ownerConfirmed: true });
    await service.refresh(subscription.id);
    await service.refresh(subscription.id);
    const inbox = new UniversalInboxService({ adapters: [createSubscriptionsInboxAdapter(service)] });
    await inbox.ready();
    expect((await inbox.list({ sourceKind: 'subscriptions' })).total).toBe(0);
  });
});
