import type { CollaborationService } from '@keystone/core';
import { getMobileSettingsRuntime, subscribeMobileSettingsRuntime } from './settingsRuntime';

export interface MobileCollaborationRuntime { readonly collaboration: CollaborationService; }

export function getMobileCollaborationRuntime(): MobileCollaborationRuntime | undefined {
  const collaboration = getMobileSettingsRuntime()?.collaboration;
  return collaboration ? { collaboration } : undefined;
}

export function subscribeMobileCollaborationRuntime(listener: () => void): () => void { return subscribeMobileSettingsRuntime(listener); }
