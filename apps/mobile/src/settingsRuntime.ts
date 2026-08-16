import type { AgentAutomationService, AgentMailbox, AgentRuntime, AgentVisitService, AIComputeRouter, AIOrchestrator, AISettingsService, DeviceService, FileStorageManager, MemoryService, NetworkDiagnosticsService, SecurityCenterService, SettingsService, SharedSpaceService, SkillRegistry, ToolAuditLog, UnifiedContextResolver } from '@keystone/core';
import { AISettingsService as CoreAISettingsService, InMemorySettingsStorage, SettingsService as CoreSettingsService } from '@keystone/core';
import type { MobileBackupRuntime } from './backupRuntime';

/** Native bootstrap installs durable settings/device/security services here. */
export interface MobileSettingsRuntime {
  settings: SettingsService;
  devices?: DeviceService;
  security?: SecurityCenterService;
  network?: NetworkDiagnosticsService;
  storage?: FileStorageManager;
  backup?: MobileBackupRuntime;
  ai?: AISettingsService;
  /** Optional trusted-device AI mesh installed by the native host. */
  personalAI?: AIComputeRouter;
  /** Optional private-first assistant coordinator installed by the native host. */
  orchestrator?: AIOrchestrator;
  /** Optional typed AI skill registry installed by the native host. */
  skills?: SkillRegistry;
  /** Optional metadata-only tool activity audit installed by the native host. */
  toolAudit?: ToolAuditLog;
  /** Optional local-first agent runtime with durable sessions/runs. */
  agents?: AgentRuntime;
  /** Optional Chronos-backed Agent automation service installed by the host. */
  automations?: AgentAutomationService;
  /** Optional local-first Personal Memory service installed by the host. */
  memory?: MemoryService;
  /** Optional signed agent-visit / Agent Room service installed by the host. */
  visits?: AgentVisitService;
  /** Optional P2P Shared Space service installed by the native host. */
  spaces?: SharedSpaceService;
  /** Optional local-first Personal AI context resolver installed by the host. */
  context?: UnifiedContextResolver;
  /** Optional asynchronous Agent Social mailbox installed by the host. */
  agentSocial?: AgentMailbox;
}
const fallback: MobileSettingsRuntime = { settings: new CoreSettingsService(new InMemorySettingsStorage()), ai: new CoreAISettingsService() };
let current: MobileSettingsRuntime | undefined = fallback;
const listeners = new Set<() => void>();
export function installMobileSettingsRuntime(runtime: MobileSettingsRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileSettingsRuntime(): MobileSettingsRuntime | undefined { return current; }
export function subscribeMobileSettingsRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
