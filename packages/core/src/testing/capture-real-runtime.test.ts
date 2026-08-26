import { describe, expect, it } from 'vitest';
import { CaptureService } from '../capture.js';

describe('R0P94 controlled runtime proof', () => {
  it('exercises the production-shaped clipboard and browser boundaries without touching the user clipboard', async () => {
    const service = new CaptureService({
      clipboard: { read: async ({ maxBytes }) => ({ text: `controlled clipboard fixture ${maxBytes}` }) },
      browser: { currentPage: async () => ({ url: 'https://runtime.example.test/page', title: 'Controlled page' }), selection: async () => ({ selectedText: 'controlled selection' }) },
    });
    expect((await service.captureClipboard({ ownerConfirmed: true })).provenance.source.kind).toBe('CLIPBOARD');
    expect((await service.captureBrowserPage({ ownerConfirmed: true })).provenance.source.kind).toBe('BROWSER_PAGE');
    expect((await service.captureBrowserSelection({ ownerConfirmed: true })).provenance.source.kind).toBe('BROWSER_SELECTION');
  });
});
