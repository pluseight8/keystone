import { describe, expect, it } from 'vitest';
import { BrowserArtifactTaskGraphAdapter, browserArtifactToTaskArtifactInput, type BrowserArtifactLike } from './browser-artifacts.js';

function artifact(overrides: Partial<BrowserArtifactLike> = {}): BrowserArtifactLike {
  return {
    id: 'browser-artifact-1',
    sourceUrl: 'https://example.test/article',
    sourceOrigin: 'https://example.test',
    extractedData: { title: 'Example' },
    citations: [{ quote: 'Example' }],
    timestamp: new Date().toISOString(),
    pageRevision: 3,
    fileRefs: ['file-1'],
    provenance: { sessionId: 'session-1', tabId: 'tab-1', ownerAgentId: 'eight', execution: 'local', sourceType: 'browser-page', untrustedSource: true },
    integrity: { algorithm: 'SHA-256', digest: 'abc123' },
    dataClass: 'PUBLIC',
    trust: 'UNTRUSTED',
    ...overrides,
  };
}

describe('BrowserArtifactTaskGraphAdapter', () => {
  it('preserves one browser source and provenance when entering a TaskGraph', () => {
    const input = new BrowserArtifactTaskGraphAdapter().toTaskArtifactInput(artifact());
    expect(input.objectReferences).toEqual(['browser-artifact-1', 'file-1']);
    expect(input.scope).toEqual({ dataClasses: ['PUBLIC'], sourceKinds: ['browser'], objectIds: ['browser-artifact-1', 'file-1'] });
    expect(input.citations[0]).toMatchObject({ id: 'browser-artifact-1', sourceType: 'browser-page' });
    expect((input.value as { provenance: unknown }).provenance).toMatchObject({ tabId: 'tab-1', sourceType: 'browser-page' });
    expect(browserArtifactToTaskArtifactInput(artifact()).id).toBe('browser-artifact:browser-artifact-1');
  });

  it('rejects forged provenance and private external artifacts', () => {
    expect(() => browserArtifactToTaskArtifactInput(artifact({ trust: 'PUBLIC' as never }))).toThrow(/provenance/i);
    expect(() => browserArtifactToTaskArtifactInput(artifact({ dataClass: 'PRIVATE', provenance: { ...artifact().provenance, execution: 'external' } }))).toThrow(/external/i);
  });
});
