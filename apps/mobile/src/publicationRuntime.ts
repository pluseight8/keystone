import type { PublicationVisibility } from '@keystone/core';

export interface MobilePublicationState {
  publicationId: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED';
  visibility: PublicationVisibility;
  revisionNumber?: number;
  link?: string;
}

export interface MobilePublicationRuntime {
  state(publicationId: string): Promise<MobilePublicationState | undefined>;
  preview(publicationId: string): Promise<{ title: string; publisherIdentity: string; visibility: PublicationVisibility } | undefined>;
  publish(publicationId: string, input: { visibility: PublicationVisibility; ownerConfirmed: true }): Promise<MobilePublicationState>;
  unpublish(publicationId: string): Promise<MobilePublicationState>;
}

let runtime: MobilePublicationRuntime | undefined;
const listeners = new Set<() => void>();
export function configureMobilePublicationRuntime(next: MobilePublicationRuntime | undefined): void { runtime = next; listeners.forEach(listener => listener()); }
export function getMobilePublicationRuntime(): MobilePublicationRuntime | undefined { return runtime; }
export function subscribeMobilePublicationRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
