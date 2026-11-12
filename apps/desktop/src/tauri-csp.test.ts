import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type TauriConfig = {
  app?: {
    security?: {
      csp?: string;
    };
  };
};

const tauriConfigPath = fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url));

function readCsp(): string {
  const config = JSON.parse(readFileSync(tauriConfigPath, 'utf8')) as TauriConfig;
  const csp = config.app?.security?.csp;

  if (!csp) {
    throw new Error(`Tauri CSP is missing from ${tauriConfigPath}`);
  }

  return csp;
}

describe('desktop Tauri CSP', () => {
  it('allows WebAssembly compilation without relaxing script or resource restrictions', () => {
    const csp = readCsp();
    const scriptDirective = csp.split(';').find((directive) => directive.trim().startsWith('script-src'));

    expect(scriptDirective).toBe(" script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src\s+\*/);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' https: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:*");
    expect(csp).not.toContain('http://*');
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('lets the app play its own imported media from blob URLs, and nothing wider', () => {
    const media = readCsp().split(';').find((directive) => directive.trim().startsWith('media-src'));
    // Without this WebKit refuses blob: audio/video, so imported media can be neither probed nor played.
    expect(media).toBe(" media-src 'self' blob:");
  });
});
