import type { AgentAutomationService, AgentMailbox, AgentNegotiationService, AgentPresenceService, AgentProfileService, AgentRuntime, AgentSocialGraphService, AgentVisitService, AIComputeRouter, AIContextCacheManager, AIOrchestrator, AIResourceScheduler, AISettingsService, CollaborationService, ContactService, DailyLayerService, DeviceService, EphemeralAgentWorkerService, FileStorageManager, ImmutableCore, IntegrityManifest, LocationService, MemoryService, NetworkDiagnosticsService, SecurityCenterService, SettingsService, SharedSpaceService, SkillRegistry, TaskGraphExecutor, TaskService, ToolAuditLog, UnifiedContextResolver } from '@keystone/core';
import { AISettingsService as CoreAISettingsService, DailyLayerService as CoreDailyLayerService, InMemorySettingsStorage, SafetyRuntime, SettingsService as CoreSettingsService } from '@keystone/core';
import type { MobileBackupRuntime } from './backupRuntime';
import type { MobileContinuityRuntime } from './continuityRuntime';
import type { MobileNearbyExchangeRuntime } from './nearbyExchangeRuntime';

/** Native bootstrap installs durable settings/device/security services here. */
export interface MobileSettingsRuntime {
  settings: SettingsService;
  devices?: DeviceService;
  security?: SecurityCenterService;
  network?: NetworkDiagnosticsService;
  /** Optional OS-authorized LocationService; location is never a boot dependency. */
  location?: LocationService;
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
  /** Optional first-class R0P81 collaboration service installed by the native host. */
  collaboration?: CollaborationService;
  /** Optional first-class R0P84 device continuity host projection. */
  continuity?: MobileContinuityRuntime;
  /** Optional first-class R0P85 Nearby Exchange host projection. */
  nearbyExchange?: MobileNearbyExchangeRuntime;
  /** Optional local-first Personal AI context resolver installed by the host. */
  context?: UnifiedContextResolver;
  /** Optional deterministic local Daily Layer projection installed by the host. */
  daily?: DailyLayerService;
  /** Optional asynchronous Agent Social mailbox installed by the host. */
  agentSocial?: AgentMailbox;
  /** Optional privacy-preserving negotiation service over AgentMailbox. */
  agentNegotiation?: AgentNegotiationService;
  /** Optional owner-bound AgentProfile service installed by the native host. */
  agentProfiles?: AgentProfileService;
  /** Optional separate agent-only social graph installed by the native host. */
  agentGraph?: AgentSocialGraphService;
  /** Optional signed presence and Personal Concierge service. */
  agentPresence?: AgentPresenceService;
  /** Optional unified local AI resource scheduler. */
  resourceScheduler?: AIResourceScheduler;
  /** Optional disposable KV/context cache manager for AgentSessions. */
  contextCache?: AIContextCacheManager;
  /** Optional bounded ephemeral workers owned by the long-lived Agent Bot. */
  workers?: EphemeralAgentWorkerService;
  /** Optional bounded DAG executor that composes the existing worker service. */
  taskGraphs?: TaskGraphExecutor;
  /** Optional first-class R0P91 TaskService installed by the native host. */
  tasks?: TaskService;
  /** Optional first-class R0P92 ContactService installed by the native host. */
  contacts?: ContactService;
  /** Mandatory local Content Safety Runtime for every shared/public surface. */
  safety: SafetyRuntime;
  /** Verified release core supplied by the native host before privileged startup. */
  immutableCore?: ImmutableCore;
  /** Host-provided signed manifest; never synthesized by the UI. */
  releaseManifest?: IntegrityManifest;
  /** Recovery/reinstall actions are host boundaries and never accept an UI bypass. */
  integrityRecovery?: {
    verifyAgain?: () => Promise<void>;
    repairHost?: () => Promise<void>;
    verifyRecoveryArtifact?: () => Promise<void>;
  };
}
const fallback: MobileSettingsRuntime = { settings: new CoreSettingsService(new InMemorySettingsStorage()), ai: new CoreAISettingsService(), daily: new CoreDailyLayerService({ ownerId: 'local-device' }), safety: new SafetyRuntime() };
let current: MobileSettingsRuntime | undefined = fallback;
const listeners = new Set<() => void>();
export function installMobileSettingsRuntime(runtime: MobileSettingsRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileSettingsRuntime(): MobileSettingsRuntime | undefined { return current; }
export function subscribeMobileSettingsRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
