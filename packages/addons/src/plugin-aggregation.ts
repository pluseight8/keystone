import { PluginPlatformError } from './plugin-platform.js';
import type { PluginExtensionContext } from './plugin-api.js';
import type { PluginMediaProvider, PluginMediaQuery, ExternalMediaObject, ProviderHealth, PluginSearchProvider, PluginSearchQuery, PluginSearchResult } from './plugin-providers.js';
import { aggregateMediaProviders, validateProviderPage } from './plugin-providers.js';
import { aggregateSearchProviders } from './plugin-runtime.js';

/** Core-owned aggregation facade. Providers can contribute, but never choose
 * ranking, safety, privacy, attribution or source enablement. */
export interface PluginAggregationPolicy {
  readonly isProviderEnabled?: (providerId: string, kind: 'VIDEO' | 'MUSIC' | 'LIVE' | 'SEARCH') => boolean;
  readonly evaluateSafety?: (value: ExternalMediaObject | PluginSearchResult) => boolean | Promise<boolean>;
  readonly maxResults?: number;
}

export async function aggregatePluginMedia(
  providers: readonly { readonly id: string; readonly provider: PluginMediaProvider; readonly kind: 'VIDEO' | 'MUSIC' | 'LIVE'; readonly timeoutMs?: number }[],
  query: PluginMediaQuery,
  context: PluginExtensionContext,
  policy: PluginAggregationPolicy = {},
): Promise<{ readonly items: readonly ExternalMediaObject[]; readonly providers: readonly ProviderHealth[]; readonly partial: boolean }> {
  const enabled = providers.filter(entry => policy.isProviderEnabled?.(entry.id, entry.kind) ?? false).map(entry => ({ id: entry.id, provider: entry.provider, enabled: true, timeoutMs: entry.timeoutMs }));
  const result = await aggregateMediaProviders(enabled, query, context, Math.min(Math.max(policy.maxResults ?? 100, 1), 100));
  const items: ExternalMediaObject[] = [];
  for (const item of result.items) if (!policy.evaluateSafety || await policy.evaluateSafety(item)) items.push(item);
  return { items, providers: result.providers, partial: result.partial };
}

export async function aggregatePluginSearch(
  providers: readonly { readonly id: string; readonly provider: PluginSearchProvider; readonly timeoutMs?: number }[],
  query: PluginSearchQuery,
  context: PluginExtensionContext,
  policy: PluginAggregationPolicy = {},
): Promise<{ readonly results: readonly PluginSearchResult[]; readonly providers: readonly ProviderHealth[]; readonly partial: boolean }> {
  const result = await aggregateSearchProviders(providers.map(entry => ({ ...entry, enabled: policy.isProviderEnabled?.(entry.id, 'SEARCH') ?? false })), query, context, { maxResults: policy.maxResults, safety: policy.evaluateSafety });
  return result;
}

export function assertBoundedProviderCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  if (typeof cursor !== 'string' || cursor.length > 512 || /[\u0000-\u001f]/.test(cursor)) throw new PluginPlatformError('INVALID_ARGUMENT', 'Provider cursor is invalid');
  return cursor;
}

export { validateProviderPage };
