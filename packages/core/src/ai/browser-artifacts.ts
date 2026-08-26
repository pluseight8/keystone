/**
 * Bridge from the browser-engine artifact shape to the existing bounded
 * TaskGraph artifact protocol.  The bridge is structural on purpose: the core
 * package does not import a host browser implementation and BrowserArtifact
 * remains a single source reference rather than a copied media object.
 */

import type { AIDataClass } from './privacy.js';
import type { TaskArtifactCitation, TaskArtifactInput } from './task-graphs.js';
import type { WorkerDataScope } from './workers.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';

export interface BrowserArtifactLike {
  readonly id: string;
  readonly sourceUrl: string;
  readonly sourceOrigin: string;
  readonly extractedData: unknown;
  readonly citations?: readonly { readonly quote?: string; readonly locator?: string; readonly elementId?: string }[];
  readonly timestamp: string;
  readonly pageRevision: number;
  readonly screenshotRef?: string;
  readonly fileRefs?: readonly string[];
  readonly provenance: {
    readonly sessionId: string;
    readonly tabId: string;
    readonly ownerAgentId: string;
    readonly execution: 'local' | 'personal_trusted' | 'external';
    readonly sourceType: 'browser-page';
    readonly untrustedSource: true;
  };
  readonly integrity: { readonly algorithm: 'SHA-256'; readonly digest: string };
  readonly dataClass: AIDataClass;
  readonly trust: 'UNTRUSTED';
}

export interface BrowserArtifactTaskArtifactInput extends TaskArtifactInput {
  readonly kind: 'structured';
  readonly objectReferences: readonly string[];
  readonly citations: readonly TaskArtifactCitation[];
  readonly dataClass: AIDataClass;
  readonly scope: WorkerDataScope;
}

export class BrowserArtifactTaskGraphAdapter {
  constructor(private readonly protectedSurfaces: MandatorySafetySurfaceRegistry = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()))) {}
  toTaskArtifactInput(artifact: BrowserArtifactLike): BrowserArtifactTaskArtifactInput {
    validateArtifact(artifact);
    const objectReferences = unique([artifact.id, ...(artifact.fileRefs ?? [])]);
    const citations: TaskArtifactCitation[] = [{ id: artifact.id, sourceType: 'browser-page', dataClass: artifact.dataClass }];
    for (const citation of artifact.citations ?? []) {
      const id = citation.elementId ?? citation.locator ?? `${artifact.id}:citation:${citations.length}`;
      citations.push({ id: id.slice(0, 512), sourceType: 'browser-page', dataClass: artifact.dataClass });
    }
    const scope: WorkerDataScope = { dataClasses: [artifact.dataClass], sourceKinds: ['browser'], objectIds: objectReferences };
    return {
      id: `browser-artifact:${artifact.id}`,
      kind: 'structured',
      value: {
        sourceUrl: artifact.sourceUrl,
        sourceOrigin: artifact.sourceOrigin,
        extractedData: artifact.extractedData,
        timestamp: artifact.timestamp,
        pageRevision: artifact.pageRevision,
        screenshotRef: artifact.screenshotRef,
        integrity: artifact.integrity,
        provenance: artifact.provenance,
        trust: artifact.trust,
      },
      objectReferences,
      citations,
      dataClass: artifact.dataClass,
      scope,
    };
  }

  /** Mandatory Browser → Keystone sharing boundary. Raw browser artifacts are
   * never admitted to a shared/public TaskGraph without a local decision token. */
  async shareToKeystone(artifact: BrowserArtifactLike): Promise<BrowserArtifactTaskArtifactInput | undefined> {
    validateArtifact(artifact);
    const eligible = await this.protectedSurfaces.evaluate('BROWSER_SHARE', { objectId: artifact.id, domain: 'PUBLIC', value: artifact, content: artifact.extractedData, sourceType: 'browser', verified: true, authorized: true, sharing: true });
    return eligible ? this.toTaskArtifactInput(artifact) : undefined;
  }
}

export function browserArtifactToTaskArtifactInput(artifact: BrowserArtifactLike): BrowserArtifactTaskArtifactInput {
  return new BrowserArtifactTaskGraphAdapter().toTaskArtifactInput(artifact);
}

export async function shareBrowserArtifactToKeystone(artifact: BrowserArtifactLike, protectedSurfaces?: MandatorySafetySurfaceRegistry): Promise<BrowserArtifactTaskArtifactInput | undefined> {
  return new BrowserArtifactTaskGraphAdapter(protectedSurfaces).shareToKeystone(artifact);
}

function validateArtifact(artifact: BrowserArtifactLike): void {
  if (!artifact || typeof artifact !== 'object' || !safe(artifact.id) || !safe(artifact.sourceUrl) || !safe(artifact.sourceOrigin)) throw new Error('Invalid BrowserArtifact.');
  if (artifact.trust !== 'UNTRUSTED' || artifact.provenance?.untrustedSource !== true || artifact.provenance?.sourceType !== 'browser-page') throw new Error('BrowserArtifact provenance is invalid.');
  if (!['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'].includes(artifact.dataClass)) throw new Error('BrowserArtifact data class is invalid.');
  if (artifact.provenance.execution === 'external' && (artifact.dataClass === 'PRIVATE' || artifact.dataClass === 'SECRET')) throw new Error('Private browser artifacts cannot enter an external TaskGraph.');
  if (artifact.integrity?.algorithm !== 'SHA-256' || !safe(artifact.integrity.digest)) throw new Error('BrowserArtifact integrity metadata is invalid.');
}

function unique(values: readonly string[]): string[] { return [...new Set(values.filter(value => safe(value)))].slice(0, 256); }
function safe(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 4096; }
