import { canonicalJson, sha256Hex } from './plugin-integrity.js';
import {
  PLUGIN_CAPABILITIES,
  PLUGIN_EXTENSION_POINTS,
  PLUGIN_SOURCES,
  PLUGIN_TYPES,
  type PluginCapability,
  type PluginCapabilityRequest,
  type PluginCompatibility,
  type PluginDependency,
  type PluginExtensionPoint,
  type PluginIntegrity,
  type PluginManifest,
  type PluginPackage,
  type PluginSignatureMetadata,
} from './plugin-types.js';

const ID = /^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const HASH = /^[a-f0-9]{64}$/i;
const PATH = /^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]+$/;
const MAX_CAPABILITIES = 64;
const MAX_EXTENSIONS = 64;
const MAX_DEPENDENCIES = 32;

export class PluginManifestError extends Error {
  constructor(readonly code: 'INVALID_MANIFEST' | 'INVALID_INTEGRITY' | 'UNSUPPORTED_COMPATIBILITY' | 'INVALID_PACKAGE', message: string) { super(message); this.name = 'PluginManifestError'; }
}

export function parsePluginManifest(value: unknown): PluginManifest {
  if (!isRecord(value)) throw new PluginManifestError('INVALID_MANIFEST', 'Plugin manifest must be an object');
  const id = bounded(value.id, 'id', 253); if (!ID.test(id)) throw invalid('Plugin id must be a stable reverse-domain identifier');
  const name = bounded(value.name, 'name', 120); const description = bounded(value.description ?? '', 'description', 4_000, false); const author = bounded(value.author, 'author', 240);
  const version = bounded(value.version, 'version', 80); if (!VERSION.test(version)) throw invalid('Plugin version must be semantic versioning');
  if (value.formatVersion !== 1 || value.apiVersion !== 1) throw invalid('Unsupported Plugin manifest version');
  const entrypoint = bounded(value.entrypoint, 'entrypoint', 240); if (!PATH.test(entrypoint)) throw invalid('Plugin entrypoint must be a safe relative path');
  if (!PLUGIN_TYPES.includes(value.pluginType as never)) throw invalid('Plugin type is invalid');
  const requestedCapabilities = parseCapabilityRequests(value.requestedCapabilities);
  const extensionPoints = parseStringEnumList(value.extensionPoints, PLUGIN_EXTENSION_POINTS, MAX_EXTENSIONS, 'extension point') as PluginExtensionPoint[];
  const dependencies = parseDependencies(value.dependencies, 'dependencies'); const optionalDependencies = parseDependencies(value.optionalDependencies, 'optionalDependencies');
  const dependencyLock = value.dependencyLock === undefined ? undefined : parseDependencyLock(value.dependencyLock, id);
  const keystoneCompatibility = parseCompatibility(value.keystoneCompatibility, 'Keystone compatibility');
  const platformCompatibility = parseCompatibility(value.platformCompatibility, 'platform compatibility');
  const integrity = parseIntegrity(value.integrity);
  const signatureMetadata = value.signatureMetadata === undefined ? undefined : parseSignature(value.signatureMetadata);
  const createdAt = bounded(value.createdAt, 'createdAt', 64); if (!Number.isFinite(Date.parse(createdAt))) throw invalid('Plugin createdAt is invalid');
  const metadata = parseMetadata(value.metadata);
  return { id, name, description, author, version, formatVersion: 1, apiVersion: 1, entrypoint, pluginType: value.pluginType as PluginManifest['pluginType'], requestedCapabilities, extensionPoints, dependencies, optionalDependencies, ...(dependencyLock ? { dependencyLock } : {}), keystoneCompatibility, platformCompatibility, integrity, ...(signatureMetadata ? { signatureMetadata } : {}), createdAt, ...(metadata ? { metadata } : {}) };
}

export async function validatePluginPackage(plugin: PluginPackage): Promise<PluginManifest> {
  if (!plugin || typeof plugin !== 'object') throw new PluginManifestError('INVALID_PACKAGE', 'Plugin package is invalid');
  const manifest = parsePluginManifest(plugin.manifest);
  if (!plugin || !(plugin.executable instanceof Uint8Array) || plugin.executable.byteLength === 0 || plugin.executable.byteLength > 64 * 1024 * 1024) throw new PluginManifestError('INVALID_PACKAGE', 'Plugin executable payload is invalid or too large');
  const source = plugin.source; if (!source || !PLUGIN_SOURCES.includes(source.kind) || (source.kind === 'EXPLICIT_URL' && !source.reference)) throw new PluginManifestError('INVALID_PACKAGE', 'Plugin source is invalid');
  if (plugin.resources && Object.keys(plugin.resources).length > 256) throw new PluginManifestError('INVALID_PACKAGE', 'Plugin resource count is too large');
  if (!(await hashMatchesPackage(plugin))) throw new PluginManifestError('INVALID_INTEGRITY', 'Plugin package integrity does not match manifest');
  return manifest;
}

export function manifestForIntegrity(manifest: PluginManifest): Omit<PluginManifest, 'integrity' | 'signatureMetadata'> & { readonly integrity?: never; readonly signatureMetadata?: never } { const { integrity: _integrity, signatureMetadata: _signature, ...unsigned } = manifest; return unsigned; }

function parseCapabilityRequests(value: unknown): PluginCapabilityRequest[] {
  if (!Array.isArray(value) || value.length > MAX_CAPABILITIES) throw invalid('Plugin capability requests are invalid');
  const result = value.map(item => { if (!isRecord(item) || !PLUGIN_CAPABILITIES.includes(item.capability as never)) throw invalid('Unknown Plugin capability'); const capability = item.capability as PluginCapability; const request: PluginCapabilityRequest = { capability, ...(item.reason === undefined ? {} : { reason: bounded(item.reason, 'capability reason', 500, false) }), ...(item.scope === undefined ? {} : { scope: bounded(item.scope, 'capability scope', 512) }), ...(item.resourceScope === undefined ? {} : { resourceScope: bounded(item.resourceScope, 'resource scope', 512) }), ...(item.optional === undefined ? {} : { optional: item.optional === true }) }; return request; });
  if (new Set(result.map(item => `${item.capability}:${item.scope ?? ''}:${item.resourceScope ?? ''}`)).size !== result.length) throw invalid('Plugin capability requests must be unique');
  return result;
}

function parseDependencies(value: unknown, label: string): PluginDependency[] { if (!Array.isArray(value) || value.length > MAX_DEPENDENCIES) throw invalid(`Plugin ${label} are invalid`); const result = value.map(item => { if (!isRecord(item)) throw invalid(`Plugin ${label} are invalid`); const id = bounded(item.id, 'dependency id', 253); if (!ID.test(id)) throw invalid('Dependency id is invalid'); const version = bounded(item.version, 'dependency version', 120); if (version.length > 120) throw invalid('Dependency version constraint is too long'); const integrity = item.integrity === undefined ? undefined : bounded(item.integrity, 'dependency integrity', 64); if (integrity !== undefined && !HASH.test(integrity)) throw invalid('Dependency integrity is invalid'); return { id, version, ...(integrity ? { integrity } : {}) }; }); if (new Set(result.map(item => item.id)).size !== result.length) throw invalid(`Plugin ${label} must not contain duplicate ids`); return result; }
function parseDependencyLock(value: unknown, pluginId: string): import('./plugin-types.js').PluginDependencyLock { if (!isRecord(value) || value.pluginId !== pluginId || !Array.isArray(value.dependencies) || typeof value.graphHash !== 'string' || !/^[a-f0-9]{8,128}$/i.test(value.graphHash)) throw invalid('Plugin dependency lock is invalid'); const dependencies = value.dependencies.map(item => { if (!isRecord(item) || typeof item.id !== 'string' || !ID.test(item.id) || typeof item.version !== 'string' || typeof item.integrity !== 'string' || !HASH.test(item.integrity)) throw invalid('Plugin dependency lock is invalid'); return { id: item.id, version: item.version, integrity: item.integrity }; }); return { pluginId, dependencies, graphHash: value.graphHash }; }
function parseCompatibility(value: unknown, label: string): PluginCompatibility { if (!isRecord(value) || !isRecord(value.api) || value.api.min !== 1 || value.api.max !== 1) throw invalid(`${label} is unsupported`); const platforms = parseOptionalEnumList(value.platforms, ['linux', 'windows', 'macos', 'android', 'ios', 'web'] as const, 8, 'platform'); const architectures = parseOptionalStrings(value.architectures, 16, 'architecture'); const runtimes = parseOptionalEnumList(value.runtimes, ['tauri-isolated-webview', 'quickjs', 'wasmtime', 'mobile-isolated-js'] as const, 8, 'runtime'); const extensions = value.extensionPoints === undefined ? undefined : parseStringEnumList(value.extensionPoints, PLUGIN_EXTENSION_POINTS, MAX_EXTENSIONS, 'extension point'); const range = value.keystone === undefined ? undefined : parseRange(value.keystone); return { api: { min: 1, max: 1 }, ...(range ? { keystone: range } : {}), ...(platforms ? { platforms } : {}), ...(architectures ? { architectures } : {}), ...(runtimes ? { runtimes } : {}), ...(extensions ? { extensionPoints: extensions } : {}) }; }
function parseRange(value: unknown): { min?: string; max?: string } { if (!isRecord(value)) throw invalid('Compatibility release range is invalid'); const min = value.min === undefined ? undefined : bounded(value.min, 'compatibility min', 80); const max = value.max === undefined ? undefined : bounded(value.max, 'compatibility max', 80); if (min && !VERSION.test(min) || max && !VERSION.test(max)) throw invalid('Compatibility release range is invalid'); return { ...(min ? { min } : {}), ...(max ? { max } : {}) }; }
function parseIntegrity(value: unknown): PluginIntegrity { if (!isRecord(value) || value.algorithm !== 'SHA-256' || !HASH.test(String(value.packageHash)) || !HASH.test(String(value.entrypointHash)) || !isRecord(value.resourceHashes)) throw invalid('Plugin integrity metadata is invalid'); const resourceHashes: Record<string, string> = {}; for (const [path, hash] of Object.entries(value.resourceHashes)) { if (!PATH.test(path) || !HASH.test(String(hash)) || Object.keys(resourceHashes).length >= 256) throw invalid('Plugin resource integrity is invalid'); resourceHashes[path] = String(hash); } return { algorithm: 'SHA-256', packageHash: String(value.packageHash), entrypointHash: String(value.entrypointHash), resourceHashes, ...(value.treeHash === undefined ? {} : { treeHash: bounded(value.treeHash, 'tree hash', 64) }) }; }
function parseSignature(value: unknown): PluginSignatureMetadata { if (!isRecord(value) || value.algorithm !== 'ED25519' || !bounded(value.signerIdentity, 'signer identity', 512) || !bounded(value.signature, 'signature', 512)) throw invalid('Plugin signature metadata is invalid'); const publicKey = value.publicKey === undefined ? undefined : bounded(value.publicKey, 'public key', 2048); return { algorithm: 'ED25519', signerIdentity: value.signerIdentity as string, signature: value.signature as string, ...(publicKey ? { publicKey } : {}), ...(value.signedAt === undefined ? {} : { signedAt: bounded(value.signedAt, 'signedAt', 64) }), ...(value.keyId === undefined ? {} : { keyId: bounded(value.keyId, 'key id', 256) }) }; }
function parseMetadata(value: unknown): Readonly<Record<string, string | number | boolean>> | undefined { if (value === undefined) return undefined; if (!isRecord(value) || Object.keys(value).length > 32) throw invalid('Plugin metadata is invalid'); const output: Record<string, string | number | boolean> = {}; for (const [key, item] of Object.entries(value)) { if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof item) || typeof item === 'number' && !Number.isFinite(item)) throw invalid('Plugin metadata is invalid'); output[key] = item as string | number | boolean; } return output; }
function parseStringEnumList<T extends string>(value: unknown, allowed: readonly T[], max: number, label: string): T[] { if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || !allowed.includes(item as T))) throw invalid(`Plugin ${label} list is invalid`); const result = value as T[]; if (new Set(result).size !== result.length) throw invalid(`Plugin ${label} list contains duplicates`); return [...result]; }
function parseOptionalEnumList<T extends string>(value: unknown, allowed: readonly T[], max: number, label: string): T[] | undefined { return value === undefined ? undefined : parseStringEnumList(value, allowed, max, label); }
function parseOptionalStrings(value: unknown, max: number, label: string): string[] | undefined { if (value === undefined) return undefined; if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || item.length < 1 || item.length > 80)) throw invalid(`Plugin ${label} list is invalid`); return [...new Set(value as string[])]; }
function bounded(value: unknown, field: string, max: number, required = true): string { if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw invalid(`Plugin ${field} is invalid`); return value; }
function invalid(message: string): PluginManifestError { return new PluginManifestError('INVALID_MANIFEST', message); }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
async function hashMatchesPackage(plugin: PluginPackage): Promise<boolean> { const manifest = manifestForIntegrity(plugin.manifest); const payload = { manifest, entrypoint: plugin.manifest.entrypoint, executable: bytes(plugin.executable), resources: Object.fromEntries(Object.entries(plugin.resources ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, bytes(value)])), schemas: Object.fromEntries(Object.entries(plugin.schemas ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, bytes(value)])), uiBundle: plugin.uiBundle ? bytes(plugin.uiBundle) : undefined, migrations: Object.fromEntries(Object.entries(plugin.migrations ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, bytes(value)])) }; return (await sha256Hex(canonicalJson(payload))) === plugin.manifest.integrity.packageHash; }
function bytes(value: Uint8Array): string { if (!(value instanceof Uint8Array)) throw new PluginManifestError('INVALID_PACKAGE', 'Plugin package bytes are invalid'); let output = ''; for (const byte of value) output += byte.toString(16).padStart(2, '0'); return output; }
