/**
 * Structural host contract keeps the shell independent from the core package
 * build.  The application bootstrap installs the real CollaborationService;
 * the shell only consumes this narrow, read-only projection.
 */
export interface DesktopCollaborationParticipant {
  readonly identityId: string;
  readonly role: string;
  readonly status: string;
}

export interface DesktopCollaborationInvitation {
  readonly id: string;
  readonly invitee: string;
  readonly role: string;
  readonly status: string;
}

export interface DesktopCollaborationObjectInfo {
  readonly id: string;
  readonly kind: string;
  readonly epoch: number;
  readonly participants: readonly DesktopCollaborationParticipant[];
  readonly invitations: readonly DesktopCollaborationInvitation[];
  readonly pendingUpdates: number;
}

export interface DesktopCollaborationService {
  listObjects(): readonly DesktopCollaborationObjectInfo[];
  subscribe(listener: () => void): () => void;
}

export interface DesktopCollaborationRuntime { readonly collaboration: DesktopCollaborationService; }
let current: DesktopCollaborationRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopCollaborationRuntime(runtime: DesktopCollaborationRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getDesktopCollaborationRuntime(): DesktopCollaborationRuntime | undefined { return current; }
export function subscribeDesktopCollaborationRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
