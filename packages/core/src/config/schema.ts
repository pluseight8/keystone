import { z } from 'zod';

export const KeystoneRoleSchema = z.enum(['Self', 'Family', 'Friend', 'Addon']);
export type KeystoneRole = z.infer<typeof KeystoneRoleSchema>;

const capabilitySchema = z.object({
  clipboard: z.boolean(),
  osUiAutomation: z.boolean(),
  lifeMapRead: z.boolean(),
  p2pRequests: z.boolean(),
  initiateWebRtcCalls: z.boolean(),
}).strict();

const shortcutSchema = z.object({
  commandPalette: z.string().min(1).max(128),
  pushToTalk: z.string().min(1).max(128),
  toggleOmnipresence: z.string().min(1).max(128),
}).strict();

/**
 * Routing defaults are migration-safe and deny remote serving. Other missing
 * settings remain errors rather than undocumented runtime policy.
 */
export const KeystoneConfigSchema = z.object({
  version: z.literal(1),
  masterAiNodeId: z.string().min(1).nullable().default(null),
  allowRemoteInference: z.boolean().default(false),
  webRtc: z.object({
    devices: z.object({ cameraId: z.string().nullable(), microphoneId: z.string().nullable(), speakerId: z.string().nullable() }).strict(),
    video: z.object({ maxBitrateKbps: z.number().int().min(64).max(100_000) }).strict(),
    screenShare: z.object({ maxBitrateKbps: z.number().int().min(64).max(100_000), fps: z.number().int().min(1).max(120) }).strict(),
    audio: z.object({ noiseSuppression: z.boolean(), echoCancellation: z.boolean() }).strict(),
    autoAnswerSelf: z.boolean(),
  }).strict(),
  p2p: z.object({
    relaySeed: z.string().min(1).nullable(),
    dht: z.object({ lookupTimeoutMs: z.number().int().min(100).max(300_000), connectionTimeoutMs: z.number().int().min(100).max(300_000) }).strict(),
    bandwidth: z.object({ uploadKbps: z.number().int().min(0), downloadKbps: z.number().int().min(0) }).strict(),
    mtuBytes: z.number().int().min(576).max(65_535),
    mdnsDiscovery: z.boolean(),
    autoDownload: z.object({ selfMaxBytes: z.number().int().nonnegative(), otherMaxBytes: z.number().int().nonnegative() }).strict(),
  }).strict(),
  chat: z.object({
    typingIndicators: z.boolean(), readReceipts: z.boolean(),
    yjsSnapshotIntervalMs: z.number().int().min(1_000),
    messageTtlMs: z.number().int().positive().nullable(),
  }).strict(),
  ai: z.object({
    llmModelId: z.string().min(1), vlmModelId: z.string().min(1),
    temperature: z.number().min(0).max(2), topP: z.number().min(0).max(1),
    contextTokenLimit: z.number().int().min(128),
    rag: z.object({ engine: z.enum(['orama', 'sqlite']), chunkSizeTokens: z.number().int().min(32).max(32_768), chunkOverlapTokens: z.number().int().min(0).max(8_192) }).strict()
      .refine(value => value.chunkOverlapTokens < value.chunkSizeTokens, 'RAG overlap must be smaller than the chunk'),
    systemPrompts: z.object({ assistant: z.string(), vision: z.string(), rag: z.string() }).strict(),
    visionStreamFps: z.number().min(0.1).max(120),
  }).strict(),
  security: z.object({
    capabilities: z.object({ Self: capabilitySchema, Family: capabilitySchema, Friend: capabilitySchema, Addon: capabilitySchema }).strict(),
  }).strict(),
  omnipresence: z.object({ shortcuts: shortcutSchema, autoLaunch: z.boolean(), hideInSystemTray: z.boolean() }).strict(),
}).strict();

export interface KeystoneConfig extends z.infer<typeof KeystoneConfigSchema> {}

export const LOCAL_CONFIG_PATHS = [
  'webRtc.devices', 'omnipresence.shortcuts', 'omnipresence.autoLaunch', 'omnipresence.hideInSystemTray',
] as const;

export type LocalKeystoneConfig = Pick<KeystoneConfig, 'version'> & {
  webRtc: Pick<KeystoneConfig['webRtc'], 'devices'>;
  omnipresence: KeystoneConfig['omnipresence'];
};

export type SharedKeystoneConfig = Pick<KeystoneConfig, 'version' | 'p2p' | 'chat' | 'ai' | 'security' | 'masterAiNodeId' | 'allowRemoteInference'> & {
  webRtc: Omit<KeystoneConfig['webRtc'], 'devices'>;
};

export function splitConfig(config: KeystoneConfig): { local: LocalKeystoneConfig; shared: SharedKeystoneConfig } {
  const value = KeystoneConfigSchema.parse(config);
  const { devices, ...sharedWebRtc } = value.webRtc;
  return {
    local: { version: 1, webRtc: { devices }, omnipresence: value.omnipresence },
    shared: { version: 1, webRtc: sharedWebRtc, p2p: value.p2p, chat: value.chat, ai: value.ai, security: value.security, masterAiNodeId: value.masterAiNodeId, allowRemoteInference: value.allowRemoteInference },
  };
}

export function mergeConfig(local: LocalKeystoneConfig, shared: SharedKeystoneConfig): KeystoneConfig {
  return KeystoneConfigSchema.parse({ ...shared, webRtc: { ...shared.webRtc, devices: local.webRtc.devices }, omnipresence: local.omnipresence });
}
