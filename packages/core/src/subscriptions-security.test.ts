import { describe, expect, it } from 'vitest';
import {
  FeedFetchClient,
  FeedParser,
  InMemorySubscriptionStateStore,
  SubscriptionService,
  canonicalFeedUrl,
  isPrivateFeedUrl,
  type FeedHttpRequest,
  type FeedHttpResponse,
  type SubscriptionState,
} from './subscriptions.js';

class SecurityTransport {
  readonly requests: FeedHttpRequest[] = [];
  constructor(private readonly responses: readonly FeedHttpResponse[]) {}
  async request(input: FeedHttpRequest): Promise<FeedHttpResponse> { this.requests.push(input); const response = this.responses[this.requests.length - 1]; if (!response) throw new Error('unexpected request'); return response; }
}

const response = (status: number, headers: Record<string, string> = {}, body: string | Uint8Array = ''): FeedHttpResponse => ({ status, url: 'https://public.example.test/feed.xml', headers, body });

describe('R0P89 feed security boundary', () => {
  it('rejects XML external entities, unsafe declarations, deep nesting and oversized documents', () => {
    const parser = new FeedParser({ maxXmlDepth: 8, maxBytes: 128 });
    expect(() => parser.parse(new TextEncoder().encode('<!DOCTYPE feed [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss/>'), 'application/xml', 'https://public.example.test/feed.xml')).toThrow(/DTD|external/i);
    expect(() => parser.parse(new TextEncoder().encode('<rss><![CDATA[not a declaration]]></rss>'), 'application/xml', 'https://public.example.test/feed.xml')).not.toThrow();
    expect(() => parser.parse(new TextEncoder().encode(`<rss>${'<a>'.repeat(12)}x${'</a>'.repeat(12)}</rss>`), 'application/xml', 'https://public.example.test/feed.xml')).toThrow(/nesting|depth/i);
    expect(() => parser.parse(new TextEncoder().encode('x'.repeat(256)), 'application/rss+xml', 'https://public.example.test/feed.xml')).toThrow(/limit|recogn/i);
  });

  it('rejects credential-bearing origins and known private-network destinations', () => {
    for (const value of ['file:///etc/passwd', 'ftp://example.test/feed', 'https://user:pass@example.test/feed', 'https://example.test/feed?access_token=secret']) expect(() => canonicalFeedUrl(value)).toThrow();
    for (const value of ['http://127.0.0.1/feed', 'http://10.2.3.4/feed', 'http://192.168.1.5/feed', 'http://[::1]/feed', 'http://[fd00::1]/feed', 'http://service.local/feed']) expect(isPrivateFeedUrl(value)).toBe(true);
  });

  it('blocks HTTPS downgrade, private redirects and oversized streamed responses', async () => {
    const downgrade = new FeedFetchClient(new SecurityTransport([response(302, { location: 'http://public.example.test/feed.xml' })]));
    await expect(downgrade.fetch({ url: 'https://public.example.test/feed.xml' })).rejects.toMatchObject({ code: 'INSECURE_REDIRECT' });
    const privateRedirect = new FeedFetchClient(new SecurityTransport([response(302, { location: 'http://127.0.0.1/feed.xml' })]));
    await expect(privateRedirect.fetch({ url: 'http://public.example.test/feed.xml' })).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    const bounded = new FeedFetchClient(new SecurityTransport([response(200, { 'content-length': '1000' }, 'small')]), { maxBytes: 16 });
    await expect(bounded.fetch({ url: 'https://public.example.test/feed.xml' })).rejects.toMatchObject({ code: 'BOUNDS_EXCEEDED' });
  });

  it('sanitizes HTML before it becomes durable feed content and never enables executable enclosure MIME', async () => {
    const parser = new FeedParser();
    const feed = parser.parse(new TextEncoder().encode('<rss><channel><title>Safety</title><item><guid>x</guid><title>Item</title><description><![CDATA[<p>safe</p><script>fetch("https://evil.invalid")</script><img src="https://tracker.invalid/a" onerror="alert(1)"><a href="javascript:alert(1)">bad</a>]]></description></item></channel></rss>'), 'application/rss+xml', 'https://public.example.test/feed.xml');
    const content = feed.entries[0]?.contentHtml ?? '';
    expect(content).toContain('safe');
    expect(content).not.toMatch(/<script\b|\sonerror=|javascript:|\ssrc=/i);

    const transport = new SecurityTransport([
      response(200, { 'content-type': 'application/rss+xml' }, '<rss><channel><title>Pod</title><item><guid>ep</guid><title>Episode</title><enclosure url="https://public.example.test/episode" type="audio/mpeg"/></item></channel></rss>'),
      response(200, { 'content-type': 'text/html' }, '<script>not audio</script>'),
    ]);
    const service = new SubscriptionService({ feedClient: new FeedFetchClient(transport) });
    const subscription = await service.subscribe({ url: 'https://public.example.test/feed.xml', ownerConfirmed: true });
    await service.refresh(subscription.id);
    const entry = (await service.listEntries()).items[0]!;
    await expect(service.downloadEnclosure(entry.id, entry.enclosures[0]!.id)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect((await service.getEntry(entry.id))?.downloads[entry.enclosures[0]!.id]?.state).toBe('FAILED');
  });

  it('does not let persisted private-network intent become runtime authorization', async () => {
    const store = new InMemorySubscriptionStateStore();
    const source = new SubscriptionService({ stateStore: store });
    const privateSubscription = await source.subscribe({ url: 'http://127.0.0.1:9/feed.xml', ownerConfirmed: true, allowPrivateNetwork: true });
    await source.flush();
    const transport = new SecurityTransport([]);
    const recovered = new SubscriptionService({ stateStore: store, feedClient: new FeedFetchClient(transport) });
    const result = await recovered.refresh(privateSubscription.id);
    expect(result.status).toBe('ERROR');
    expect(result.status === 'ERROR' && result.error.code).toBe('SSRF_BLOCKED');
    expect(transport.requests).toHaveLength(0);
  });

  it('does not accept a forged state shape as a feed source', async () => {
    const state: Partial<SubscriptionState> = { version: 1, protocol: 'keystone.subscriptions.r0p89', subscriptions: { forged: { privateNetworkRequested: true } as never } };
    const store = new InMemorySubscriptionStateStore();
    await store.write(state);
    const service = new SubscriptionService({ stateStore: store });
    expect(await service.listSubscriptions()).toHaveLength(0);
  });
});
