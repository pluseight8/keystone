export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const ADDON_CAPABILITIES = ['ai_prompt', 'life_map_read', 'p2p_request'] as const;
export type AddonCapability = (typeof ADDON_CAPABILITIES)[number];

export interface AddonManifest {
  schema: 'keystone.addon.v1';
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Relative path inside the signed addon bundle. URLs and parent traversal are forbidden. */
  entrypoint: string;
  /** Deny by default: only declared capabilities can be requested at runtime. */
  permissions: AddonCapability[];
}

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  enum?: JsonPrimitive[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
}

export interface AddonToolDefinition {
  /** Local identifier. The engine exposes it as `<addonId>:<id>`. */
  id: string;
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Capabilities checked immediately before every execution. */
  requiredCapabilities?: AddonCapability[];
}

export interface AddonCustomNodeDefinition {
  id: string;
  displayName: string;
  glyph: string;
  color: string;
  schema?: JsonSchema;
}

/**
 * Widgets are declarative on purpose. Addons never inject React components into the
 * host tree; a trusted host renderer maps this descriptor to native UI primitives.
 */
export interface AddonWidgetDefinition {
  id: string;
  displayName: string;
  slot: 'dashboard' | 'life_map_sidebar' | 'command_palette';
  view: {
    kind: 'text' | 'list' | 'metric' | 'action';
    title: string;
  };
}

export interface AddonHooks {
  tools?: AddonToolDefinition[];
  customNodes?: AddonCustomNodeDefinition[];
  widgets?: AddonWidgetDefinition[];
}

export interface AddonActivation {
  apiVersion: 1;
  hooks?: AddonHooks;
}

export interface RegisteredAddonTool extends AddonToolDefinition {
  addonId: string;
  addonName: string;
  qualifiedName: string;
}

export interface RegisteredCustomNode extends AddonCustomNodeDefinition {
  addonId: string;
  addonName: string;
  qualifiedType: string;
}

export interface RegisteredWidget extends AddonWidgetDefinition {
  addonId: string;
  addonName: string;
  qualifiedId: string;
}

export interface AddonConfirmationRequest {
  addonId: string;
  addonName: string;
  capability: Extract<AddonCapability, 'life_map_read' | 'p2p_request'>;
  /** Host UI must show this exact leading sentence before the swipe control. */
  message: string;
  details: string;
}

export interface AddonConfirmationGateway {
  confirm(request: AddonConfirmationRequest): Promise<boolean>;
}

export interface AddonCapabilityContext {
  addon: Pick<AddonManifest, 'id' | 'name' | 'version'>;
  capability: AddonCapability;
  operation: string;
  input: JsonValue;
}

export type AddonCapabilityHandler = (context: AddonCapabilityContext) => Promise<JsonValue>;

export interface SandboxHostCall {
  capability: string;
  operation: string;
  input: JsonValue;
  reason: string;
}

export interface AddonSandboxSession {
  invoke(method: string, input: JsonValue): Promise<JsonValue>;
  dispose(): Promise<void>;
}

export interface AddonSandboxRuntime {
  readonly isolation: 'tauri-isolated-webview' | 'quickjs' | 'wasmtime' | 'mobile-isolated-js' | 'test';
  load(input: {
    manifest: AddonManifest;
    bundle: Uint8Array;
    hostCall: (call: SandboxHostCall) => Promise<JsonValue>;
  }): Promise<AddonSandboxSession>;
}

export interface AddonEngineOptions {
  runtime: AddonSandboxRuntime;
  confirmation: AddonConfirmationGateway;
  /** Optional bridge to Keystone core's DoubleConfirmation policy/audit module. */
  consent?: {
    evaluateAddonAction(input: { addonId: string; addonName: string; action: 'addon_life_map_read' | 'addon_p2p_request' }): Promise<{ mode: 'double_confirmation'; allowed: false }>;
  };
  capabilities?: Partial<Record<AddonCapability, AddonCapabilityHandler>>;
  maxBundleBytes?: number;
}
