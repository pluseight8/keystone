import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleAIProvider } from './privacy.js';

describe('default fetch in a browser host', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('calls the global fetch with the global receiver, as WebKit and Chromium require', async () => {
    // Browsers throw "Can only call Window.fetch on instances of Window" for any other receiver.
    vi.stubGlobal('fetch', function (this: unknown) {
      if (this !== globalThis && this !== undefined) throw new TypeError('Can only call Window.fetch on instances of Window');
      return Promise.resolve(new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    const provider = new OpenAICompatibleAIProvider({ id: 'lm-studio', endpoint: 'http://127.0.0.1:1234/v1/chat/completions', model: 'test', scope: 'local' });
    const health = await provider.health();
    expect(JSON.stringify(health)).not.toContain('Window.fetch');
    expect(health.state).toBe('available');
  });
});
