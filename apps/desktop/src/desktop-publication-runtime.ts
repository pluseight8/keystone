/**
 * Host boundary for the Personal Web surface.  The desktop shell never owns
 * publication authority or private publication state; a host injects this
 * adapter with the existing core PublicationService and owner policy.
 */
export type DesktopPublicationStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED';
export type DesktopPublicationVisibility = 'PUBLIC' | 'UNLISTED' | 'CONTACTS' | 'FOLLOWERS' | 'SELECTED_IDENTITIES' | 'SPACE';

export interface DesktopPublicationState {
  readonly publicationId: string;
  readonly title: string;
  readonly status: DesktopPublicationStatus;
  readonly visibility: DesktopPublicationVisibility;
  readonly revisionNumber?: number;
  readonly revisionAddress?: string;
  readonly link?: string;
  readonly updatedAt?: string;
}

export interface DesktopPublicationPreview {
  readonly title: string;
  readonly visibility: DesktopPublicationVisibility;
  readonly publisherIdentity: string;
  readonly includedAttachments: readonly string[];
  readonly externalLinks: readonly { url: string; safe: boolean; warning?: string }[];
}

export interface DesktopPublicationRuntime {
  state(publicationId: string): Promise<DesktopPublicationState | undefined>;
  preview(publicationId: string): Promise<DesktopPublicationPreview | undefined>;
  publish(publicationId: string, input: { visibility: DesktopPublicationVisibility; ownerConfirmed: true }): Promise<DesktopPublicationState>;
  unpublish(publicationId: string): Promise<DesktopPublicationState>;
}

let runtime: DesktopPublicationRuntime | undefined;
const listeners = new Set<() => void>();

export function configureDesktopPublicationRuntime(next: DesktopPublicationRuntime | undefined): void {
  runtime = next;
  listeners.forEach(listener => listener());
}

export function getDesktopPublicationRuntime(): DesktopPublicationRuntime | undefined { return runtime; }
export function subscribeDesktopPublicationRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
