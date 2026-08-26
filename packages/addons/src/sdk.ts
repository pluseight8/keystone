/**
 * Public Plugin SDK entrypoint.
 *
 * This module intentionally exports contracts, validators and the development
 * test kit only.  It does not export PluginRegistry, SecretStore, Identity
 * keys, Core service containers or production runtime implementations.
 */
export type {
  PluginCapability,
  PluginManifest,
  PluginPackage,
  PluginRevision,
  PluginProviderRegistration,
  PluginUiExtensionRegistration,
  PluginExtensionContext,
  PluginExtensionCompatibility,
  PluginExtensionQuota,
  PluginExtensionHandle,
} from './index.js';
export { PLUGIN_API_VERSION, PLUGIN_API_FEATURES, PluginApiRegistry } from './plugin-api.js';
export type { PluginApiVersion, PluginApiFeature, PluginApiRange, PluginFeatureVersion, PluginApiCompatibilityResult } from './plugin-api.js';
export type * from './plugin-providers.js';
export { PluginTestHost, PluginFixtureBuilder, ProviderTestHarness, validateSettingsValue } from './plugin-runtime.js';
export { assertBoundedProviderCursor, validateProviderPage } from './plugin-aggregation.js';
export { parsePluginManifest, validatePluginPackage } from './plugin-manifest.js';
