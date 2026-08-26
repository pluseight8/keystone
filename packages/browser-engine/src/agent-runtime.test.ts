import { describe, expect, it } from 'vitest';
import {
  BrowserAgentError,
  BrowserAgentRuntime,
  BrowserContextExtractor,
  BrowserPolicy,
  type BrowserHostAdapter,
  type BrowserHostActionOutput,
  type BrowserIntent,
  type BrowserPageState,
  type BrowserCredentialAdapter,
} from './index.js';

function page(tabId: string, url = 'https://example.test/', revision = 1, dataClass: BrowserPageState['dataClass'] = 'PUBLIC'): BrowserPageState {
  return {
    version: 1,
    tabId,
    url,
    origin: new URL(url).origin,
    title: 'Example',
    pageRevision: revision,
    dataClass,
    visibleText: 'Hello from an untrusted page',
    interactiveElements: [{ id: 'submit', role: 'button', label: 'Submit', pageRevision: revision, elementRevision: 1 }],
    accessibilitySnapshot: 'button Submit',
    updatedAt: new Date().toISOString(),
  };
}

function host(): BrowserHostAdapter & { pages: Map<string, BrowserPageState>; actions: BrowserIntent[] } {
  const value: BrowserHostAdapter & { pages: Map<string, BrowserPageState>; actions: BrowserIntent[] } = {
    pages: new Map(),
    actions: [],
    async observe(tabId) { return value.pages.get(tabId) ?? page(tabId); },
    async openTab(tabId, url) { value.pages.set(tabId, page(tabId, url)); return { page: value.pages.get(tabId) }; },
    async closeTab(tabId) { value.pages.delete(tabId); },
    async execute(intent, context) {
      value.actions.push(intent);
      const current = value.pages.get(context.tabId) ?? page(context.tabId);
      if (intent.type === 'NAVIGATE' && intent.url) value.pages.set(context.tabId, page(context.tabId, intent.url, current.pageRevision + 1));
      else if (['CLICK', 'TYPE', 'SELECT', 'SCROLL', 'SUBMIT'].includes(intent.type)) value.pages.set(context.tabId, page(context.tabId, current.url, current.pageRevision + 1));
      return { page: value.pages.get(context.tabId), value: intent.type === 'EXTRACT_TEXT' ? current.visibleText : undefined };
    },
  };
  return value;
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.length); input.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', input.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

describe('BrowserAgentRuntime', () => {
  it('keeps credential autofill host-only and binds it to exact origin/revision', async () => {
    const adapter = host(); let fills = 0;
    const credentials: BrowserCredentialAdapter = {
      async available(origin, pageRevision) { return { kind: 'CREDENTIAL_AVAILABLE', credentialHandleId: 'credential:one', origin, pageRevision, fields: ['username', 'password'] }; },
      async fill(intent) { fills += 1; return { accepted: true, filledFieldIds: intent.fieldIds }; },
    };
    const runtime = new BrowserAgentRuntime({ host: adapter, credentialAdapter: credentials });
    const session = runtime.createSession({ id: 'session-credential', ownerAgentId: 'eight' });
    const tab = await runtime.openTab(session.id, 'https://example.test/');
    const available = await runtime.credentialAvailable(session.id, tab.id);
    expect(available).toMatchObject({ credentialHandleId: 'credential:one', origin: 'https://example.test', pageRevision: 1 });
    await expect(runtime.fillCredential(session.id, { kind: 'FILL_CREDENTIAL_INTENT', credentialHandleId: 'credential:one', origin: 'https://evil.test', pageRevision: 1, fieldIds: ['password'], confirmed: true }, tab.id)).rejects.toMatchObject({ code: 'CREDENTIAL_ACCESS_DENIED' } satisfies Partial<BrowserAgentError>);
    await expect(runtime.fillCredential(session.id, { kind: 'FILL_CREDENTIAL_INTENT', credentialHandleId: 'credential:one', origin: 'https://example.test', pageRevision: 1, fieldIds: ['password'], confirmed: true }, tab.id)).resolves.toMatchObject({ accepted: true });
    adapter.pages.set(tab.id, page(tab.id, tab.url, 2));
    await expect(runtime.fillCredential(session.id, { kind: 'FILL_CREDENTIAL_INTENT', credentialHandleId: 'credential:one', origin: 'https://example.test', pageRevision: 1, fieldIds: ['password'], confirmed: true }, tab.id)).rejects.toMatchObject({ code: 'CREDENTIAL_ACCESS_DENIED' } satisfies Partial<BrowserAgentError>);
    await expect(runtime.credentialAvailable(session.id, tab.id)).resolves.toMatchObject({ pageRevision: 2 });
    await expect(runtime.fillCredential(session.id, { kind: 'FILL_CREDENTIAL_INTENT', credentialHandleId: 'credential:one', origin: 'https://example.test', pageRevision: 2, fieldIds: ['password'], confirmed: true }, tab.id)).resolves.toMatchObject({ accepted: true });
    expect(fills).toBe(2);
    expect(JSON.stringify(available)).not.toMatch(/password-value|secret/i);
  });

  it('uses typed intents and rejects arbitrary JavaScript or unsafe URLs', async () => {
    const adapter = host();
    const runtime = new BrowserAgentRuntime({ host: adapter });
    const session = runtime.createSession({ id: 'session-safe', ownerAgentId: 'eight' });
    const tab = await runtime.openTab(session.id, 'https://example.test/');
    const arbitrary = await runtime.dispatch(session.id, { type: 'EVAL' as never, tabId: tab.id } as never);
    expect(arbitrary.status).toBe('REJECTED');
    expect(arbitrary.errorCode).toBe('INVALID_ARGUMENT');
    await expect(runtime.openTab(session.id, 'javascript:alert(1)')).rejects.toMatchObject({ code: 'INVALID_REDIRECT' } satisfies Partial<BrowserAgentError>);
    expect(adapter.actions).toHaveLength(0);
  });

  it('supports navigation, semantic click, stale reference rejection, and context budgets', async () => {
    const adapter = host();
    const runtime = new BrowserAgentRuntime({ host: adapter, budgets: { maxSteps: 8 } });
    const session = runtime.createSession({ id: 'session-actions', ownerAgentId: 'eight' });
    const tab = await runtime.openTab(session.id, 'https://example.test/');
    const observed = await runtime.observe(session.id, tab.id);
    const click = await runtime.dispatch(session.id, { type: 'CLICK', tabId: tab.id, target: observed.interactiveElements[0], expectedPageRevision: observed.pageRevision });
    expect(click.status).toBe('COMPLETED');
    const stale = await runtime.dispatch(session.id, { type: 'CLICK', tabId: tab.id, target: observed.interactiveElements[0], expectedPageRevision: observed.pageRevision });
    expect(stale.status).toBe('STALE');
    const navigate = await runtime.dispatch(session.id, { type: 'NAVIGATE', tabId: tab.id, url: 'https://example.test/next' });
    expect(navigate.status).toBe('COMPLETED');
    expect(navigate.page?.url).toContain('/next');
    const context = await runtime.observe(session.id, tab.id);
    expect(context.untrusted).toBe(true);
    expect(context.visibleText).toContain('untrusted');
  });

  it('keeps private pages and credentials outside external model scope', async () => {
    const adapter = host();
    const runtime = new BrowserAgentRuntime({ host: adapter, policy: new BrowserPolicy({ allowPrivatePages: true }) });
    const session = runtime.createSession({ id: 'session-external', ownerAgentId: 'worker', execution: 'external' });
    const tab = await runtime.openTab(session.id, 'https://example.test/private');
    adapter.pages.set(tab.id, page(tab.id, tab.url, 2, 'PRIVATE'));
    const result = await runtime.dispatch(session.id, { type: 'EXTRACT_TEXT', tabId: tab.id });
    expect(result.status).toBe('REJECTED');
    expect(result.errorCode).toBe('PRIVATE_PAGE_EXTERNAL');
    const extracted = new BrowserContextExtractor().extractForSession(session.id, page(tab.id, tab.url, 2, 'PRIVATE'));
    expect(extracted.interactiveElements[0]).not.toHaveProperty('value');
    await expect(runtime.observe(session.id, tab.id)).rejects.toMatchObject({ code: 'PRIVATE_PAGE_EXTERNAL' } satisfies Partial<BrowserAgentError>);
    expect(runtime.getSession(session.id)?.tabs[0]?.url).toBe('about:private');
  });

  it('requires explicit uploads and quarantines bounded downloads with integrity metadata', async () => {
    const adapter = host();
    adapter.execute = async (intent, context): Promise<BrowserHostActionOutput> => {
      adapter.actions.push(intent);
      if (intent.type === 'DOWNLOAD') return { download: { mimeType: 'text/plain', size: 5, bytes: new Uint8Array([104, 101, 108, 108, 111]), sourceUrl: 'https://example.test/file.txt' } };
      return { page: adapter.pages.get(context.tabId) };
    };
    const runtime = new BrowserAgentRuntime({ host: adapter, downloadBoundary: { quarantine: async download => ({ ...download, objectId: 'quarantine-browser-text', sha256: await hashBytes(download.bytes ?? new Uint8Array()), quarantine: 'UNTRUSTED' }) } });
    const session = runtime.createSession({ id: 'session-files', ownerAgentId: 'eight' });
    const tab = await runtime.openTab(session.id, 'https://example.test/');
    const denied = await runtime.dispatch(session.id, { type: 'UPLOAD_EXPLICIT_FILE', tabId: tab.id, file: { fileId: 'f', contentId: 'c', filename: 'x.txt', mimeType: 'text/plain', size: 1 } as never });
    expect(denied.status).toBe('REJECTED');
    expect(denied.errorCode).toBe('UPLOAD_NOT_EXPLICIT');
    const download = await runtime.dispatch(session.id, { type: 'DOWNLOAD', tabId: tab.id });
    expect(download.status).toBe('COMPLETED');
    expect(download.download?.quarantine).toBe('UNTRUSTED');
    expect(download.download?.sha256).toMatch(/^[0-9a-f-]+$/);
  });

  it('bounds tabs, handles human takeover, and produces provenance-bearing artifacts', async () => {
    const adapter = host();
    const runtime = new BrowserAgentRuntime({ host: adapter, budgets: { maxTabs: 2, maxSteps: 4 } });
    const session = runtime.createSession({ id: 'session-control', ownerAgentId: 'eight' });
    const tab = await runtime.openTab(session.id, 'https://example.test/');
    await runtime.openTab(session.id, 'https://example.test/second');
    await expect(runtime.openTab(session.id, 'https://example.test/third')).rejects.toMatchObject({ code: 'TAB_LIMIT' } satisfies Partial<BrowserAgentError>);
    const paused = runtime.takeControl(session.id);
    expect(paused.paused).toBe(true);
    const blocked = await runtime.dispatch(session.id, { type: 'CLICK', tabId: tab.id });
    expect(blocked.errorCode).toBe('PAUSED');
    await runtime.recordManualAction(session.id, tab.id);
    await runtime.resume(session.id);
    const artifact = await runtime.createArtifact(session.id, { tabId: tab.id, extractedData: { answer: 'public' }, citations: [{ quote: 'Hello' }] });
    expect(artifact.provenance.untrustedSource).toBe(true);
    expect(artifact.sourceUrl).toContain('example.test');
    expect(artifact.integrity.algorithm).toBe('SHA-256');
  });

  it('runs an observe-plan-act loop with a hard stop and confirmation boundary', async () => {
    const adapter = host();
    const runtime = new BrowserAgentRuntime({ host: adapter, policy: new BrowserPolicy({ requireConfirmationFor: ['SUBMIT'] }), budgets: { maxSteps: 3 } });
    const session = runtime.createSession({ id: 'session-loop', ownerAgentId: 'eight' });
    await runtime.openTab(session.id, 'https://example.test/');
    const result = await runtime.runTask({ sessionId: session.id, planner: async ({ step, context }) => step === 0 ? { intent: { type: 'SUBMIT', tabId: context.tabId } } : { done: true } });
    expect(result.state).toBe('NEEDS_USER');
    expect(result.reason).toMatch(/confirmation/i);
  });

  it('composes existing ToolPolicy and AIEgressFirewall boundaries without exposing raw page data', async () => {
    const adapter = host();
    const seen: string[] = [];
    const runtime = new BrowserAgentRuntime({
      host: adapter,
      toolPolicy: { authorizeBrowserIntent: ({ intent }) => { seen.push(intent.type); return intent.type !== 'DOWNLOAD'; } },
      egressFirewall: { checkBrowserArtifact: input => { seen.push(`${input.execution}:${input.dataClass}:${input.sourceOrigin}`); return input.dataClass === 'PUBLIC'; } },
    });
    const session = runtime.createSession({ id: 'session-policy', ownerAgentId: 'eight' });
    const tab = await runtime.openTab(session.id, 'https://example.test/');
    expect((await runtime.dispatch(session.id, { type: 'DOWNLOAD', tabId: tab.id })).errorCode).toBe('INTENT_NOT_ALLOWED');
    await expect(runtime.createArtifact(session.id, { tabId: tab.id, extractedData: { safe: true } })).resolves.toMatchObject({ dataClass: 'PUBLIC' });
    expect(seen).toContain('DOWNLOAD');
    expect(seen.some(entry => entry.includes('PUBLIC:https://example.test'))).toBe(true);
  });

  it('requires the host-provided download boundary and never opens a browser download', async () => {
    const adapter = host(); adapter.execute = async (intent, context): Promise<BrowserHostActionOutput> => intent.type === 'DOWNLOAD' ? { download: { filename: '../../tool.exe', mimeType: 'application/octet-stream', size: 2, bytes: Uint8Array.from([0x4d, 0x5a]), sourceUrl: 'https://example.test/tool.exe' } } : { page: adapter.pages.get(context.tabId) };
    const seen: string[] = []; const runtime = new BrowserAgentRuntime({ host: adapter, downloadBoundary: { quarantine: async download => { seen.push(download.filename ?? ''); return { ...download, objectId: 'quarantine-browser-exe', sha256: await hashBytes(download.bytes ?? new Uint8Array()), quarantine: 'UNTRUSTED' }; } } });
    const session = runtime.createSession({ id: 'session-download-boundary', ownerAgentId: 'eight' }); const tab = await runtime.openTab(session.id, 'https://example.test/'); const result = await runtime.dispatch(session.id, { type: 'DOWNLOAD', tabId: tab.id });
    expect(result.status).toBe('COMPLETED'); expect(result.download?.quarantine).toBe('UNTRUSTED'); expect(seen[0]).toContain('..');
  });

  it('fails closed when a browser host has no quarantine boundary', async () => {
    const adapter = host(); adapter.execute = async (intent, context): Promise<BrowserHostActionOutput> => intent.type === 'DOWNLOAD' ? { download: { mimeType: 'application/octet-stream', size: 2, bytes: Uint8Array.from([0x4d, 0x5a]), sourceUrl: 'https://example.test/tool.exe' } } : { page: adapter.pages.get(context.tabId) };
    const runtime = new BrowserAgentRuntime({ host: adapter }); const session = runtime.createSession({ id: 'session-download-no-boundary', ownerAgentId: 'eight' }); const tab = await runtime.openTab(session.id, 'https://example.test/');
    const result = await runtime.dispatch(session.id, { type: 'DOWNLOAD', tabId: tab.id });
    expect(result.status).toBe('FAILED'); expect(result.errorCode).toBe('HOST_UNAVAILABLE');
  });

  it('exposes only an explicit, revision-bound capture representation', async () => {
    const adapter = host(); let captures = 0;
    adapter.capturePage = async (tabId, request, context) => {
      captures += 1;
      expect(request.ownerConfirmed).toBe(true);
      expect(context.pageRevision).toBe(1);
      expect(Object.keys(request)).not.toEqual(expect.arrayContaining(['cookies', 'headers', 'path', 'javascript']));
      return {
        requestedUrl: adapter.pages.get(tabId)?.url ?? 'https://example.test/',
        finalUrl: 'https://example.test/article',
        title: 'Captured article',
        html: '<article><h1>Captured</h1><p>Untrusted source</p><script>bad()</script></article>',
        resources: [{ originalUrl: 'https://example.test/image.png', bytes: Uint8Array.from([1, 2, 3]), mimeType: 'image/png', kind: 'IMAGE' }],
        redirectCount: 1,
      };
    };
    const runtime = new BrowserAgentRuntime({ host: adapter });
    const session = runtime.createSession({ id: 'session-capture', ownerAgentId: 'eight' });
    const tab = await runtime.openTab(session.id, 'https://example.test/');
    const captured = await runtime.capturePage(session.id, { mode: 'SAFE_PAGE_ARCHIVE', ownerConfirmed: true, expectedPageRevision: 1 }, tab.id);
    expect(captured.finalUrl).toBe('https://example.test/article');
    expect(captured.resources?.[0]?.bytes).toEqual(Uint8Array.from([1, 2, 3]));
    expect(captures).toBe(1);
    await expect(runtime.capturePage(session.id, { mode: 'SAFE_PAGE_ARCHIVE', ownerConfirmed: false } as never, tab.id)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' } satisfies Partial<BrowserAgentError>);
    adapter.pages.set(tab.id, page(tab.id, tab.url, 2));
    await expect(runtime.capturePage(session.id, { mode: 'SAFE_PAGE_ARCHIVE', ownerConfirmed: true, expectedPageRevision: 1 }, tab.id)).rejects.toMatchObject({ code: 'STALE_PAGE' } satisfies Partial<BrowserAgentError>);
  });

  it('does not let external execution capture a private page', async () => {
    const adapter = host(); adapter.capturePage = async tabId => ({ requestedUrl: adapter.pages.get(tabId)?.url ?? 'https://example.test/', title: 'Private', html: '<p>secret</p>' });
    const runtime = new BrowserAgentRuntime({ host: adapter, policy: new BrowserPolicy({ allowPrivatePages: true }) });
    const session = runtime.createSession({ id: 'session-capture-private', ownerAgentId: 'external', execution: 'external' });
    const tab = await runtime.openTab(session.id, 'https://example.test/private');
    adapter.pages.set(tab.id, page(tab.id, tab.url, 2, 'PRIVATE'));
    await expect(runtime.capturePage(session.id, { mode: 'READER_SNAPSHOT', ownerConfirmed: true }, tab.id)).rejects.toMatchObject({ code: 'CAPTURE_NOT_ALLOWED' } satisfies Partial<BrowserAgentError>);
  });
});
