import type { CanvasService, MarkdownNote, SharedVaultService, VaultBookmarksService, VaultQueryService, VaultTaskIndexService, VaultTemplateService, DailyNoteService, VaultGraphService, VaultService, VaultSearchResult, VaultTransclusionService } from '@keystone/core';

/** Native host installs the existing VaultService; Expo UI never accesses files directly. */
export interface MobileVaultRuntime {
  readonly vault: VaultService;
  readonly vaultId?: string;
  readonly graph?: VaultGraphService;
  readonly canvas?: CanvasService;
  readonly transclusion?: VaultTransclusionService;
  readonly daily?: DailyNoteService;
  readonly templates?: VaultTemplateService;
  readonly bookmarks?: VaultBookmarksService;
  readonly queries?: VaultQueryService;
  readonly tasks?: VaultTaskIndexService;
  readonly sharedVaults?: readonly SharedVaultService[];
  readonly subscribe?: (listener: () => void) => () => void;
}
let current: MobileVaultRuntime | undefined;
const listeners = new Set<() => void>();
export function installMobileVaultRuntime(runtime: MobileVaultRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getMobileVaultRuntime(): MobileVaultRuntime | undefined { return current; }
export function subscribeMobileVaultRuntime(listener: () => void): () => void { listeners.add(listener); const hostStop = current?.subscribe?.(listener); return () => { listeners.delete(listener); hostStop?.(); }; }
export type { MarkdownNote, VaultSearchResult };
