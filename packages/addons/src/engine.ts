import { parseAddonManifest } from './manifest.js';
import type {
  AddonActivation,
  AddonCapability,
  AddonCustomNodeDefinition,
  AddonEngineOptions,
  AddonManifest,
  AddonToolDefinition,
  AddonWidgetDefinition,
  JsonValue,
  RegisteredAddonTool,
  RegisteredCustomNode,
  RegisteredWidget,
  SandboxHostCall,
  AddonSandboxSession,
} from './types.js';
import { ADDON_CAPABILITIES as KNOWN_CAPABILITIES } from './types.js';

const CONFIRMED_CAPABILITIES = new Set<AddonCapability>(['life_map_read', 'p2p_request']);
const HOOK_KEYS = new Set(['tools', 'customNodes', 'widgets']);
const ACTIVATION_KEYS = new Set(['apiVersion', 'hooks']);
const LOCAL_ID = /^[a-z][a-z0-9_-]{0,63}$/;

export class AddonSecurityError extends Error {
  constructor(readonly code: 'CAPABILITY_NOT_DECLARED' | 'CAPABILITY_UNAVAILABLE' | 'USER_DENIED' | 'INVALID_SANDBOX_REQUEST', message: string) {
    super(message);
  }
}

export class AddonEngine {
  private readonly addons = new Map<string, { manifest: AddonManifest; session: AddonSandboxSession }>();
  private readonly tools = new Map<string, RegisteredAddonTool>();
  private readonly customNodes = new Map<string, RegisteredCustomNode>();
  private readonly widgets = new Map<string, RegisteredWidget>();
  private readonly maxBundleBytes: number;

  constructor(private readonly options: AddonEngineOptions) {
    this.maxBundleBytes = options.maxBundleBytes ?? 10 * 1024 * 1024;
  }

  async install(rawManifest: unknown, bundle: Uint8Array): Promise<AddonManifest> {
    const manifest = parseAddonManifest(rawManifest);
    if (!bundle.byteLength || bundle.byteLength > this.maxBundleBytes) throw new Error('Addon bundle size is invalid');
    if (this.addons.has(manifest.id)) throw new Error(`Addon is already installed: ${manifest.id}`);
    let session: AddonSandboxSession | undefined;
    try {
      session = await this.options.runtime.load({
        manifest,
        bundle: bundle.slice(),
        hostCall: call => this.handleSandboxHostCall(manifest, call),
      });
      const activation = parseActivation(await session.invoke('activate', { apiVersion: 1 }));
      this.registerHooks(manifest, activation);
      this.addons.set(manifest.id, { manifest, session });
      return manifest;
    } catch (error) {
      this.removeHooks(manifest.id);
      await session?.dispose().catch(() => undefined);
      throw error;
    }
  }

  async uninstall(addonId: string): Promise<void> {
    const addon = this.addons.get(addonId);
    if (!addon) return;
    this.addons.delete(addonId);
    this.removeHooks(addonId);
    await addon.session.dispose();
  }

  listAddons(): readonly AddonManifest[] { return [...this.addons.values()].map(value => value.manifest); }
  listTools(): readonly RegisteredAddonTool[] { return [...this.tools.values()]; }
  listCustomNodes(): readonly RegisteredCustomNode[] { return [...this.customNodes.values()]; }
  listWidgets(): readonly RegisteredWidget[] { return [...this.widgets.values()]; }

  async executeTool(qualifiedName: string, input: JsonValue): Promise<JsonValue> {
    const tool = this.tools.get(qualifiedName);
    if (!tool) throw new Error(`Unknown addon tool: ${qualifiedName}`);
    if (containsLegacySecretField(input)) throw new AddonSecurityError('INVALID_SANDBOX_REQUEST', 'Addon tools cannot receive legacy secret material');
    assertSchema(input, tool.parameters, `$input(${qualifiedName})`);
    const addon = this.requireAddon(tool.addonId);
    for (const capability of tool.requiredCapabilities ?? []) await this.authorize(addon.manifest, capability, `Execute AI tool ${tool.name}`);
    return addon.session.invoke(`tool:${tool.id}`, cloneJson(input));
  }

  private async handleSandboxHostCall(manifest: AddonManifest, call: SandboxHostCall): Promise<JsonValue> {
    if (!isRecord(call) || typeof call.capability !== 'string' || typeof call.operation !== 'string' || typeof call.reason !== 'string' || !isJsonValue(call.input)) {
      throw new AddonSecurityError('INVALID_SANDBOX_REQUEST', 'Sandbox host call is malformed');
    }
    if (containsLegacySecretField(call.input)) throw new AddonSecurityError('INVALID_SANDBOX_REQUEST', 'Addon host calls cannot carry legacy secret material');
    if (!(KNOWN_CAPABILITIES as readonly string[]).includes(call.capability)) throw new AddonSecurityError('INVALID_SANDBOX_REQUEST', `Unknown host capability: ${call.capability}`);
    const capability = call.capability as AddonCapability;
    await this.authorize(manifest, capability, call.reason);
    const handler = this.options.capabilities?.[capability];
    if (!handler) throw new AddonSecurityError('CAPABILITY_UNAVAILABLE', `Host capability is unavailable: ${capability}`);
    return handler({ addon: { id: manifest.id, name: manifest.name, version: manifest.version }, capability, operation: call.operation, input: cloneJson(call.input) });
  }

  private async authorize(manifest: AddonManifest, capability: AddonCapability, details: string): Promise<void> {
    if (!manifest.permissions.includes(capability)) throw new AddonSecurityError('CAPABILITY_NOT_DECLARED', `Addon ${manifest.name} did not declare ${capability}`);
    if (CONFIRMED_CAPABILITIES.has(capability)) {
      await this.options.consent?.evaluateAddonAction({ addonId: manifest.id, addonName: manifest.name, action: capability === 'life_map_read' ? 'addon_life_map_read' : 'addon_p2p_request' });
      const approved = await this.options.confirmation.confirm({
        addonId: manifest.id,
        addonName: manifest.name,
        capability: capability as 'life_map_read' | 'p2p_request',
        message: `Аддон ${manifest.name} запрашивает доступ...`,
        details,
      });
      if (!approved) throw new AddonSecurityError('USER_DENIED', `User denied ${capability} for addon ${manifest.name}`);
    }
  }

  private requireAddon(addonId: string): { manifest: AddonManifest; session: AddonSandboxSession } {
    const addon = this.addons.get(addonId);
    if (!addon) throw new Error(`Addon is not installed: ${addonId}`);
    return addon;
  }

  private registerHooks(manifest: AddonManifest, activation: AddonActivation): void {
    const hooks = activation.hooks;
    for (const definition of hooks?.tools ?? []) {
      validateTool(definition, manifest);
      const qualifiedName = `${manifest.id}:${definition.id}`;
      if (this.tools.has(qualifiedName)) throw new Error(`Duplicate addon tool: ${qualifiedName}`);
      this.tools.set(qualifiedName, { ...definition, addonId: manifest.id, addonName: manifest.name, qualifiedName });
    }
    for (const definition of hooks?.customNodes ?? []) {
      validateCustomNode(definition);
      const qualifiedType = `${manifest.id}:${definition.id}`;
      if (this.customNodes.has(qualifiedType)) throw new Error(`Duplicate custom node: ${qualifiedType}`);
      this.customNodes.set(qualifiedType, { ...definition, addonId: manifest.id, addonName: manifest.name, qualifiedType });
    }
    for (const definition of hooks?.widgets ?? []) {
      validateWidget(definition);
      const qualifiedId = `${manifest.id}:${definition.id}`;
      if (this.widgets.has(qualifiedId)) throw new Error(`Duplicate addon widget: ${qualifiedId}`);
      this.widgets.set(qualifiedId, { ...definition, addonId: manifest.id, addonName: manifest.name, qualifiedId });
    }
  }

  private removeHooks(addonId: string): void {
    removeOwned(this.tools, addonId);
    removeOwned(this.customNodes, addonId);
    removeOwned(this.widgets, addonId);
  }
}

function parseActivation(value: JsonValue): AddonActivation {
  if (!isJsonObject(value)) throw new Error('Addon activation response is invalid');
  const record = value as Record<string, JsonValue>;
  if (Object.keys(record).some(key => !ACTIVATION_KEYS.has(key)) || record.apiVersion !== 1) throw new Error('Addon activation response is invalid');
  if (record.hooks === undefined) return { apiVersion: 1 };
  if (!isJsonObject(record.hooks) || Object.keys(record.hooks).some(key => !HOOK_KEYS.has(key))) throw new Error('Addon hooks are invalid');
  const hooks = record.hooks;
  for (const key of HOOK_KEYS) if (hooks[key] !== undefined && !Array.isArray(hooks[key])) throw new Error(`Addon hook ${key} must be an array`);
  return { apiVersion: 1, hooks: hooks as unknown as AddonActivation['hooks'] };
}

function validateTool(value: AddonToolDefinition, manifest: AddonManifest): void {
  if (!isRecord(value) || !LOCAL_ID.test(value.id) || !shortString(value.name, 80) || !shortString(value.description, 500) || !isRecord(value.parameters)) throw new Error('Addon tool definition is invalid');
  if (value.requiredCapabilities && (!Array.isArray(value.requiredCapabilities) || value.requiredCapabilities.some(capability => !manifest.permissions.includes(capability)))) throw new Error(`Addon tool ${value.id} requires an undeclared capability`);
}

function validateCustomNode(value: AddonCustomNodeDefinition): void {
  if (!isRecord(value) || !LOCAL_ID.test(value.id) || !shortString(value.displayName, 80) || !shortString(value.glyph, 8) || !/^#[0-9a-fA-F]{6}$/.test(value.color)) throw new Error('Addon custom node definition is invalid');
}

function validateWidget(value: AddonWidgetDefinition): void {
  if (!isRecord(value) || !LOCAL_ID.test(value.id) || !shortString(value.displayName, 80) || !['dashboard', 'life_map_sidebar', 'command_palette'].includes(value.slot) || !isRecord(value.view) || !['text', 'list', 'metric', 'action'].includes(String(value.view.kind)) || !shortString(value.view.title, 120)) throw new Error('Addon widget definition is invalid');
}

function assertSchema(value: JsonValue, schema: AddonToolDefinition['parameters'], path: string): void {
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length && !types.some(type => matchesType(value, type))) throw new Error(`${path} does not match the addon tool schema`);
  if (schema.enum && !schema.enum.some(candidate => candidate === value)) throw new Error(`${path} is not an allowed value`);
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => assertSchema(item, schema.items!, `${path}[${index}]`));
  if (isRecord(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) if (!(required in value)) throw new Error(`${path}.${required} is required`);
    for (const [key, child] of Object.entries(value)) {
      const property = properties[key];
      if (property) assertSchema(child, property, `${path}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${path}.${key} is not allowed`);
      else if (isRecord(schema.additionalProperties)) assertSchema(child, schema.additionalProperties, `${path}.${key}`);
    }
  }
}

function matchesType(value: JsonValue, type: string): boolean {
  switch (type) {
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return isRecord(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'boolean': return typeof value === 'boolean';
    default: return false;
  }
}

function shortString(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } { return isRecord(value); }
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return typeof value !== 'number' || Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
function cloneJson<T extends JsonValue>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function removeOwned<T extends { addonId: string }>(map: Map<string, T>, addonId: string): void { for (const [key, value] of map) if (value.addonId === addonId) map.delete(key); }
const LEGACY_SECRET_FIELDS = new Set(['masterSeed', 'sessionKeys', 'DeviceSessionKeys', 'privateKey', 'encryptionPrivateKey', 'secretKey', 'rawKey', 'keyMaterial', 'sessionSecret', 'exportKey', 'getKey', 'getSecret']);
function containsLegacySecretField(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(containsLegacySecretField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => LEGACY_SECRET_FIELDS.has(key) || containsLegacySecretField(child as JsonValue));
}
