import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FetchFeedHttpTransport,
  FeedFetchClient,
  InMemoryFeedEnclosureStore,
  SubscriptionService,
} from '../subscriptions.js';

const servers: Server[] = [];

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('loopback server did not expose a port');
  return address.port;
}

async function close(server: Server): Promise<void> { await new Promise<void>(resolve => server.close(() => resolve())); }

afterEach(async () => { for (const server of servers.splice(0)) if (server.listening) await close(server); });

describe('R0P89 production-shaped loopback HTTP and podcast proof', () => {
  it('refreshes through real FetchFeedHttpTransport, honors ETag, stores explicit audio and keeps cached data offline', async () => {
    let version = 1;
    const requests: { readonly url: string; readonly headers: Record<string, string | string[] | undefined> }[] = [];
    const episodeBytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      requests.push({ url: request.url ?? '', headers: request.headers });
      if (request.url === '/redirect') { response.writeHead(302, { location: '/feed.xml' }); response.end(); return; }
      if (request.url === '/episode.mp3') {
        const range = request.headers.range;
        const start = range ? Number(range.match(/bytes=(\d+)-/)?.[1] ?? 0) : 0;
        const body = episodeBytes.subarray(Math.min(start, episodeBytes.length));
        response.writeHead(range ? 206 : 200, { 'content-type': 'audio/mpeg', 'content-length': body.length, ...(range ? { 'content-range': `bytes ${start}-${episodeBytes.length - 1}/${episodeBytes.length}` } : {}) });
        response.end(body); return;
      }
      if (request.url === '/feed.xml') {
        const etag = version === 1 ? '"feed-v1"' : '"feed-v2"';
        if (request.headers['if-none-match'] === etag) { response.writeHead(304, { etag, 'cache-control': 'no-store' }); response.end(); return; }
        const item = version === 1 ? '<guid>episode-1</guid><title>First episode</title>' : '<guid>episode-2</guid><title>Second episode</title>';
        response.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8', etag, 'cache-control': 'no-store' });
        response.end(`<rss version="2.0"><channel><title>Loopback podcast</title><link>http://127.0.0.1/</link><item>${item}<link>http://127.0.0.1/article</link><description><![CDATA[<p>Episode ${version}</p>]]></description><enclosure url="http://127.0.0.1:${(server.address() as { port: number }).port}/episode.mp3" type="audio/mpeg" length="8"/></item></channel></rss>`);
        return;
      }
      response.writeHead(404); response.end();
    });
    const port = await listen(server);
    const feedUrl = `http://127.0.0.1:${port}/redirect`;
    const service = new SubscriptionService({ feedClient: new FeedFetchClient(new FetchFeedHttpTransport()), enclosureStore: new InMemoryFeedEnclosureStore() });
    const subscription = await service.subscribe({ url: feedUrl, ownerConfirmed: true, allowPrivateNetwork: true });

    const first = await service.refresh(subscription.id);
    expect(first.status).toBe('UPDATED');
    expect(first.status === 'UPDATED' && first.newItemCount).toBe(1);
    const firstEntry = (await service.listEntries()).items[0]!;
    const download = await service.downloadEnclosure(firstEntry.id, firstEntry.enclosures[0]!.id);
    expect(download.downloads[firstEntry.enclosures[0]!.id]?.bytesDownloaded).toBe(8);
    const second = await service.refresh(subscription.id);
    expect(second.status).toBe('NOT_MODIFIED');
    version = 2;
    const third = await service.refresh(subscription.id);
    expect(third.status).toBe('UPDATED');
    expect(third.status === 'UPDATED' && third.newItemCount).toBe(1);
    expect((await service.listEntries()).total).toBe(2);
    expect(requests.some(value => Object.keys(value.headers).some(header => header.toLocaleLowerCase() === 'cookie' || header.toLocaleLowerCase() === 'authorization'))).toBe(false);
    expect(requests.some(value => value.headers['if-none-match'] === '"feed-v1"')).toBe(true);

    await close(server);
    const offline = await service.refresh(subscription.id);
    expect(offline.status).toBe('ERROR');
    expect((await service.listEntries()).total).toBe(2);
    expect(service.diagnostics().downloadedEnclosures).toBe(1);
  }, 60_000);
});
