import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BrowserAgentRuntime,
  BrowserPolicy,
  type BrowserHostAdapter,
  type BrowserPageState,
} from '@keystone/browser-engine';
import {
  BrowserRuntimeWebCaptureAdapter,
  WebCaptureService,
  WebLibraryService,
} from '../web-library.js';

const servers: Server[] = [];

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback server did not expose a port');
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()));
}

afterEach(async () => {
  for (const server of servers.splice(0)) if (server.listening) await close(server);
});

describe('R0P87 real Browser -> local archive evidence', () => {
  it('captures from a production-shaped Browser runtime and opens offline after origin shutdown', async () => {
    let pageRequests = 0;
    let assetRequests = 0;
    let externalFetchAttempts = 0;
    let submittedForms = 0;
    let server!: Server;
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      if (request.method === 'POST') submittedForms += 1;
      if (request.url?.startsWith('/article') && request.method === 'GET') {
        pageRequests += 1;
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><html><head><title>Loopback article</title></head><body>
          <article><h1>Loopback article</h1><p>Persisted before the origin goes offline.</p>
          <img src="/asset.png" alt="Local asset"><img src="https://external.invalid/tracker.gif" alt="Tracker">
          <script>globalThis.__archiveScriptExecuted = true</script>
          <form action="/submit" method="post"><input name="secret" value="never-submit"></form>
          </article></body></html>`);
        return;
      }
      if (request.url === '/asset.png' && request.method === 'GET') {
        assetRequests += 1;
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(Buffer.from([137, 80, 78, 71]));
        return;
      }
      response.writeHead(404); response.end();
    });
    const port = await listen(server);
    const origin = `http://127.0.0.1:${port}`;
    const articleUrl = `${origin}/article?token=not-persisted`;
    const pages = new Map<string, BrowserPageState>();

    const host: BrowserHostAdapter = {
      async observe(tabId) {
        const current = pages.get(tabId);
        if (!current) throw new Error('unknown tab');
        return current;
      },
      async execute() { throw new Error('This proof does not execute page actions'); },
      async openTab(tabId, url) {
        const response = await fetch(url);
        const html = await response.text();
        const page: BrowserPageState = { version: 1, tabId, url, origin: new URL(url).origin, title: 'Loopback article', pageRevision: 1, dataClass: 'PUBLIC', visibleText: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), interactiveElements: [], updatedAt: new Date().toISOString() };
        pages.set(tabId, page);
        return { page };
      },
      async capturePage(tabId, request) {
        const current = pages.get(tabId);
        if (!current) throw new Error('unknown tab');
        const response = await fetch(current.url);
        const html = await response.text();
        const resources = [];
        for (const match of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
          const resourceUrl = new URL(match[1]!, current.url);
          if (resourceUrl.origin !== current.origin) { externalFetchAttempts += 1; continue; }
          const resourceResponse = await fetch(resourceUrl);
          resources.push({ originalUrl: resourceUrl.toString(), bytes: new Uint8Array(await resourceResponse.arrayBuffer()), mimeType: resourceResponse.headers.get('content-type') ?? 'application/octet-stream', kind: 'IMAGE' as const });
        }
        return { requestedUrl: current.url, finalUrl: current.url, title: 'Loopback article', html, resources, redirectCount: 0, ...(request.includeImages === false ? { resources: [] } : {}) };
      },
    };
    const browser = new BrowserAgentRuntime({ host, policy: new BrowserPolicy({ allowedOrigins: [origin] }) });
    const session = browser.createSession({ id: 'r0p87-loopback-session', ownerAgentId: 'owner' });
    const tab = await browser.openTab(session.id, articleUrl);
    const library = new WebLibraryService();
    const capture = new WebCaptureService(library, { maxConcurrent: 1, maxQueue: 1 });
    const outcome = await capture.capture({ url: articleUrl, mode: 'SAFE_PAGE_ARCHIVE', ownerConfirmed: true }, new BrowserRuntimeWebCaptureAdapter(browser, session.id, tab.id));

    expect(outcome.state, outcome.error ?? 'capture completed').toBe('READY');
    expect(pageRequests).toBe(2); // openTab plus the explicit Save action
    expect(assetRequests).toBe(1);
    expect(externalFetchAttempts).toBe(1); // detected and skipped, never fetched
    expect(submittedForms).toBe(0);
    const requestsBeforeShutdown = pageRequests + assetRequests;
    await close(server);
    const offline = await library.render(outcome.entry.id);
    const offlineAgain = await library.render(outcome.entry.id);
    expect(offline?.html).toContain('Persisted before the origin goes offline.');
    expect(offline?.html).not.toMatch(/<script|<form|src=|javascript:/i);
    expect(offline?.html).toContain('data-keystone-resource');
    expect(offline?.externalRequestCount).toBe(0);
    expect(offline?.scriptsExecuted).toBe(0);
    expect(offline?.formsSubmitted).toBe(0);
    expect(offlineAgain?.html).toBe(offline?.html);
    expect(pageRequests + assetRequests).toBe(requestsBeforeShutdown);
    expect(outcome.entry.sourceUrl).not.toContain('token=');
  });
});
