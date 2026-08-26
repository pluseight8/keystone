import { describe, expect, it } from 'vitest';
import {
  FeedFetchClient,
  FeedParser,
  InMemoryFeedEnclosureStore,
  InMemorySubscriptionStateStore,
  OpmlService,
  SubscriptionService,
  canonicalFeedUrl,
  type FeedHttpRequest,
  type FeedHttpResponse,
} from './subscriptions.js';

class ControlledFeedTransport {
  readonly requests: FeedHttpRequest[] = [];
  private readonly responses: FeedHttpResponse[] = [];
  queue(response: FeedHttpResponse): void { this.responses.push(response); }
  async request(input: FeedHttpRequest): Promise<FeedHttpResponse> { this.requests.push(input); const response = this.responses.shift(); if (!response) throw new Error('No controlled response'); return response; }
}

function response(body: string | Uint8Array, headers: Record<string, string> = {}, status = 200): FeedHttpResponse { return { status, url: 'https://example.test/feed.xml', headers, body }; }
const rss = (title: string, guid = 'one') => `<?xml version="1.0"?><rss version="2.0"><channel><title>Example Feed</title><link>https://example.test/</link><item><guid>${guid}</guid><title>${title}</title><link>https://example.test/${guid}</link><pubDate>Tue, 01 Jan 2030 00:00:00 GMT</pubDate><description><![CDATA[<p>Hello <script>alert(1)</script><img src="https://tracker.test/pixel" onload="send()"></p>]]></description></item></channel></rss>`;

describe('R0P89 feed contracts', () => {
  it('parses RSS, Atom and JSON Feed from content and sanitizes cached HTML', () => {
    const parser = new FeedParser();
    const rssResult = parser.parse(new TextEncoder().encode(rss('RSS item')), 'application/rss+xml', 'https://example.test/feed.xml');
    expect(rssResult.format).toBe('RSS_2_0');
    expect(rssResult.entries[0]?.contentHtml).toContain('Hello');
    expect(rssResult.entries[0]?.contentHtml).not.toMatch(/<script\b|\sonload=|\ssrc=/i);
    expect(rssResult.entries[0]?.title).toBe('RSS item');
    const atom = parser.parse(new TextEncoder().encode('<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>a1</id><title>A</title><link href="https://example.test/a"/><content type="html"><![CDATA[<p>Atom body</p>]]></content></entry></feed>'), 'application/atom+xml', 'https://example.test/atom.xml');
    expect(atom.format).toBe('ATOM_1_0'); expect(atom.entries[0]?.contentHtml).toContain('Atom body');
    const json = parser.parse(new TextEncoder().encode(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'JSON', items: [{ id: 'j1', title: 'J', content_text: 'JSON body', tags: ['rust'] }] })), 'application/feed+json', 'https://example.test/feed.json');
    expect(json.format).toBe('JSON_FEED'); expect(json.entries[0]?.contentText).toBe('JSON body');
  });

  it('rejects DTD/XXE, bounds JSON nesting and rejects unsafe URL credentials', () => {
    const parser = new FeedParser();
    expect(() => parser.parse(new TextEncoder().encode('<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss/>'), 'application/xml', 'https://example.test/feed.xml')).toThrow(/external entities|DTD/i);
    expect(() => parser.parse(new TextEncoder().encode(`${'['.repeat(70)}0${']'.repeat(70)}`), 'application/json', 'https://example.test/feed.json')).toThrow(/nesting/i);
    expect(() => canonicalFeedUrl('https://user:password@example.test/feed.xml')).toThrow();
    expect(() => canonicalFeedUrl('https://example.test/feed.xml?token=secret')).toThrow();
  });

  it('uses ETag/304, keeps initial history quiet, deduplicates updates and preserves offline state', async () => {
    const transport = new ControlledFeedTransport();
    transport.queue(response(rss('Initial'), { etag: 'v1', 'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT' }));
    transport.queue({ status: 304, url: 'https://example.test/feed.xml', headers: { etag: 'v1' } });
    transport.queue(response(rss('Updated', 'two'), { etag: 'v2' }));
    const service = new SubscriptionService({ feedClient: new FeedFetchClient(transport), stateStore: new InMemorySubscriptionStateStore(), now: () => Date.parse('2025-01-01T00:00:00.000Z') });
    const subscription = await service.subscribe({ url: 'https://example.test/feed.xml', ownerConfirmed: true });
    const first = await service.refresh(subscription.id); expect(first.status).toBe('UPDATED'); expect(first.newItemCount).toBe(1); expect(service.diagnostics().unread).toBe(0); expect(transport.requests[0]?.headers['user-agent']).toContain('Keystone');
    const second = await service.refresh(subscription.id); expect(second.status).toBe('NOT_MODIFIED'); expect((await service.listEntries()).total).toBe(1); expect(transport.requests[1]?.headers['if-none-match']).toBe('v1');
    const third = await service.refresh(subscription.id); expect(third.status).toBe('UPDATED'); expect(third.newItemCount).toBe(1); expect(service.diagnostics().unread).toBe(1); expect((await service.listEntries()).total).toBe(2);
    const entry = (await service.listEntries({ readState: 'UNREAD' })).items[0]!; await service.markRead(entry.id); await service.setFavorite(entry.id, true); expect((await service.listEntries({ favorite: true })).items[0]?.id).toBe(entry.id);
  });

  it('keeps OPML preview network-free, discovers proposals without subscribing and supports folders', async () => {
    const opml = new OpmlService(); const preview = opml.preview('<opml version="2.0"><body><outline text="Tech"><outline type="rss" text="One" xmlUrl="https://example.test/one.xml"/><outline type="rss" text="Duplicate" xmlUrl="https://example.test/one.xml"/><outline type="rss" text="Local" xmlUrl="http://127.0.0.1/feed.xml"/></outline></body></opml>');
    expect(preview.feedCount).toBe(3); expect(preview.duplicateUrls).toEqual(['https://example.test/one.xml']);
    const service = new SubscriptionService(); const candidates = service.discoverFromPage({ pageUrl: 'https://example.test/article', html: '<link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml"><link rel="alternate" type="application/atom+xml" title="Comments" href="/comments.xml">' }); expect(candidates).toHaveLength(2); expect((await service.listSubscriptions())).toHaveLength(0);
    const imported = await service.importOpml(preview, true); expect(imported.subscriptions).toHaveLength(1); expect((await service.listFolders()).map(folder => folder.name)).toContain('Tech'); expect(imported.invalidUrls.join(' ')).toContain('127.0.0.1');
  });

  it('downloads explicit audio through a bounded content writer and does not auto-download by default', async () => {
    const transport = new ControlledFeedTransport();
    transport.queue(response('<rss><channel><title>Pod</title><item><guid>ep1</guid><title>Episode</title><enclosure url="https://example.test/ep.mp3" type="audio/mpeg" length="4"/></item></channel></rss>', { etag: 'p1' }));
    transport.queue(response(new Uint8Array([1, 2, 3, 4]), { 'content-type': 'audio/mpeg' }));
    const service = new SubscriptionService({ feedClient: new FeedFetchClient(transport), enclosureStore: new InMemoryFeedEnclosureStore() });
    const subscription = await service.subscribe({ url: 'https://example.test/podcast.xml', ownerConfirmed: true, autoDownloadEpisodes: false }); await service.refresh(subscription.id);
    const entry = (await service.listEntries()).items[0]!; expect(Object.keys(entry.downloads)).toHaveLength(0); const enclosure = entry.enclosures[0]!; const downloaded = await service.downloadEnclosure(entry.id, enclosure.id); expect(downloaded.downloads[enclosure.id]?.state).toBe('DOWNLOADED'); expect(downloaded.downloads[enclosure.id]?.bytesDownloaded).toBe(4);
  });
});
