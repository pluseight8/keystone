import { afterAll, describe, expect, it } from 'vitest';
import {
  AdaptiveRouteOptimizer,
  type RouteCandidate,
} from '../adaptive-route.js';
import type {
  DeliveryProfile,
  TransportProviderId,
} from '../connectivity.js';
import {
  DAILY_LAYER_MAX_ITEMS,
  DAILY_LAYER_MAX_SOURCE_ITEMS,
  DAILY_LAYER_MAX_SOURCES,
  DailyLayerService,
  type DailyContextItem,
  type DailyContextSource,
} from '../daily-layer.js';
import {
  AIContextCacheManager,
  type ContextTurn,
} from '../ai/context-cache.js';
import {
  AIResourceScheduler,
  type AIModelRuntime,
} from '../ai/resource-scheduler.js';
import {
  ContentCache,
  createContentManifest,
} from '../social/content.js';
import { InMemorySocialStorage } from '../social/messaging.js';
import type { MessageObject } from '../social/object-model.js';

/**
 * R0P78 deterministic, in-process scale evidence.
 *
 * This suite intentionally does not create one OS process per fixture.  Real
 * network lifecycle evidence remains in `test:network`; these cases exercise
 * the same bounded state machines with synthetic data and a fixed seed so
 * resource regressions are reproducible without exhausting a host.
 */

const NOW = Date.parse('2026-08-24T08:00:00.000Z');
const MODEL = { provider: 'test-local', model: 'shared' } as const;
const PROFILES: readonly DeliveryProfile[] = ['CONTROL', 'INTERACTIVE', 'REALTIME', 'BULK', 'EVENTUAL', 'BACKGROUND', 'BEST_EFFORT'];
const evidence: Record<string, number> = {};

function candidate(destination: string, index: number): RouteCandidate {
  const providerId = `provider-${index}` as TransportProviderId;
  return {
    id: `${destination}\u0000${providerId}`,
    destination,
    providerId,
    providerType: 'ControlledTransport',
    providerFamily: 'controlled',
    pathKind: 'LIVE',
    liveAvailable: true,
    eventualAvailable: false,
    supportedProfiles: PROFILES,
    securityEligible: true,
    securityReasons: [],
    availability: 'AVAILABLE',
    mtu: 64 * 1024,
    metered: false,
    energy: 'LOW',
    hopCount: 1,
    ancestry: [],
    metrics: { rttMs: 10 + index, throughputBytesPerSecond: 1_000_000 },
  };
}

function dailyItem(id: string): DailyContextItem {
  return {
    id,
    sourceType: 'tasks',
    canonicalRef: { id: `object-${id}`, type: 'task', visibility: 'private' },
    title: `Task ${id}`,
    createdAt: new Date(NOW).toISOString(),
    priority: 'informational',
    dataClass: 'PRIVATE',
  };
}

function message(index: number, conversationId: string): MessageObject {
  return {
    version: 1,
    type: 'message',
    id: `message-${index}`,
    author: 'owner',
    createdAt: new Date(NOW + index).toISOString(),
    visibility: 'private',
    references: [],
    payload: {
      conversationId,
      kind: 'text',
      text: `Synthetic message ${index}`,
      logicalClock: index + 1,
      attachments: [],
    },
    signature: 'synthetic-test-signature',
  };
}

function deterministicBytes(length: number, seed = 0x78): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition was not reached');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

describe('R0P78 bounded scale and endurance evidence', () => {
  afterAll(async () => {
    const idleStart = process.cpuUsage();
    await new Promise(resolve => setTimeout(resolve, 250));
    const idleCpu = process.cpuUsage(idleStart);
    const memory = process.memoryUsage();
    evidence.idleWindowMs = 250;
    evidence.idleCpuUserMs = idleCpu.user / 1_000;
    evidence.idleCpuSystemMs = idleCpu.system / 1_000;
    evidence.rssBytes = memory.rss;
    evidence.heapUsedBytes = memory.heapUsed;
    console.info(`[R0P78-PERF] ${JSON.stringify(evidence)}`);
  });

  it('keeps route selection bounded at 100 destinations × 100 candidates', () => {
    const optimizer = new AdaptiveRouteOptimizer({ maxCacheEntries: 64, maxDestinations: 32, maxObservations: 128, maxBackups: 4 });
    const started = Date.now();
    for (let destinationIndex = 0; destinationIndex < 100; destinationIndex += 1) {
      const destination = `destination-${destinationIndex}`;
      optimizer.select(destination, { profile: 'INTERACTIVE' }, Array.from({ length: 100 }, (_, index) => candidate(destination, index)));
    }
    const diagnostics = optimizer.diagnostics();
    evidence.routeSelection100x100Ms = Date.now() - started;
    expect(diagnostics.cacheEntries).toBeLessThanOrEqual(64);
    expect(diagnostics.observations).toBeLessThanOrEqual(128);
    expect(diagnostics.maxBackups).toBe(4);
    expect(diagnostics.candidateEvaluations).toBe(10_000);
    // This is intentionally generous: it catches accidental quadratic work,
    // not machine-specific latency noise.
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('bounds Daily Layer aggregation from thousands of source candidates', async () => {
    const values = Array.from({ length: DAILY_LAYER_MAX_SOURCE_ITEMS }, (_, index) => dailyItem(`item-${index}`));
    const sources: DailyContextSource[] = Array.from({ length: DAILY_LAYER_MAX_SOURCES }, (_, sourceIndex) => ({
      sourceType: 'tasks',
      sourceId: `tasks-${sourceIndex}`,
      trust: 'core',
      collect: () => values,
    }));
    const service = new DailyLayerService({ ownerId: 'scale-owner', now: () => NOW, timezone: 'UTC', maxItems: DAILY_LAYER_MAX_ITEMS, maxSourceItems: DAILY_LAYER_MAX_SOURCE_ITEMS, sources });
    const started = Date.now();
    const brief = await service.generateBrief({ mode: 'day', notify: false });
    const durationMs = Date.now() - started;
    evidence.dailyAggregation8192Ms = durationMs;
    expect(brief.metrics.consideredCount).toBeLessThanOrEqual(DAILY_LAYER_MAX_SOURCES * DAILY_LAYER_MAX_SOURCE_ITEMS);
    expect(brief.items.length).toBeLessThanOrEqual(DAILY_LAYER_MAX_ITEMS);
    expect(brief.metrics.sourceCount).toBe(DAILY_LAYER_MAX_SOURCES);
    expect(durationMs).toBeLessThan(10_000);
  });

  it('keeps durable message history queryable at 10k objects without duplicating IDs', async () => {
    const storage = new InMemorySocialStorage();
    const conversationId = 'conversation-scale';
    const started = Date.now();
    for (let index = 0; index < 10_000; index += 1) await storage.upsertMessage(message(index, conversationId));
    const values = await storage.messages(conversationId);
    evidence.messageHistory10kMs = Date.now() - started;
    expect(values).toHaveLength(10_000);
    expect(new Set(values.map(value => value.id)).size).toBe(10_000);
    expect(values[0]?.payload.logicalClock).toBe(1);
    expect(values.at(-1)?.payload.logicalClock).toBe(10_000);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('shares one model runtime while keeping 20 agent contexts isolated and evictable', async () => {
    const runtime: AIModelRuntime & { loads: number; calls: unknown[] } = {
      model: MODEL,
      loads: 0,
      calls: [],
      async load() { runtime.loads += 1; },
      async unload() { /* keep-loaded policy controls lifecycle */ },
      async infer<T>(input: unknown): Promise<T> { runtime.calls.push(input); return input as T; },
    };
    const scheduler = new AIResourceScheduler({ runtimeFactory: () => runtime, keepLoaded: 'always', mode: 'BALANCED', budget: { maxConcurrency: 2, foregroundConcurrency: 2, backgroundConcurrency: 1 } });
    const contexts = new AIContextCacheManager({ mode: 'BALANCED', policy: { maxHotSessions: 4, maxWarmSessions: 4, maxTotalKvRamBytes: 64 * 1024 * 1024, maxTotalKvVramBytes: 128 * 1024 * 1024 } });
    await contexts.ready();
    const started = Date.now();
    const jobs = Array.from({ length: 20 }, (_, index) => {
      const agentId = `agent-${index}`;
      const sessionId = `session-${index}`;
      return contexts.ensureSession({ agentId, sessionId, namespace: `${agentId}:${sessionId}`, model: MODEL }).then(async () => {
        const turn: ContextTurn = { id: `turn-${index}`, role: 'user', text: `private context ${index}`, dataClass: 'PRIVATE', createdAt: new Date(NOW + index).toISOString() };
        await contexts.appendTurn({ agentId, sessionId }, turn);
        return contexts.runWithScheduler(scheduler, { agentId, sessionId, model: MODEL, priority: 'ACTIVE_AGENT', kind: 'scale', persist: false }, { currentPrompt: `prompt-${index}`, tokenBudget: 128, recentTurns: [turn], allowedDataClasses: ['PRIVATE'] }, async (plan, execution) => {
          expect(plan.agentId).toBe(agentId);
          expect(plan.contextItems.every(item => item.id === turn.id)).toBe(true);
          return execution.runtime.infer({ agentId, sessionId }, execution.signal);
        });
      });
    });
    await Promise.all(jobs);
    evidence.agentContexts20Ms = Date.now() - started;
    expect(runtime.loads).toBe(1);
    expect(runtime.calls).toHaveLength(20);
    expect(new Set(runtime.calls.map(value => JSON.stringify(value))).size).toBe(20);
    await contexts.applyMemoryPressure('high');
    const usage = contexts.getUsage();
    expect(usage.totalKvRamBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(usage.hotSessions).toBeLessThanOrEqual(4);
    expect(usage.warmSessions).toBeLessThanOrEqual(4);
    expect((await contexts.snapshot()).every(state => state.agentId && state.sessionId)).toBe(true);
    scheduler.close();
  });

  it('keeps a 1000-chunk content cache within quota and verifies every chunk', async () => {
    const chunkSize = 16 * 1024;
    const bytes = deterministicBytes(chunkSize * 1_000);
    const manifest = await createContentManifest(bytes, { mimeType: 'application/octet-stream', name: 'scale.bin', chunkSize, contentPolicy: 'PUBLIC_CACHEABLE' });
    const cache = new ContentCache(bytes.byteLength + chunkSize);
    const started = Date.now();
    await cache.putManifest(manifest);
    for (let index = 0; index < manifest.chunks.length; index += 1) {
      await cache.putVerifiedChunk(manifest, index, bytes.subarray(index * chunkSize, (index + 1) * chunkSize));
    }
    expect(manifest.chunks).toHaveLength(1_000);
    expect(cache.usageBytes()).toBe(bytes.byteLength);
    expect(cache.missing(manifest)).toHaveLength(0);
    expect(cache.chunk(manifest.contentId, 999)).toEqual(bytes.subarray(999 * chunkSize));
    evidence.content1000ChunksMs = Date.now() - started;
    expect(evidence.content1000ChunksMs).toBeLessThan(20_000);
  });

  it('keeps bounded resource profiles from changing security eligibility', async () => {
    const optimizer = new AdaptiveRouteOptimizer({ resourceProfile: 'BATTERY_SAVER' });
    const highEnergy = candidate('metered', 1);
    const denied = optimizer.select('metered', { profile: 'BACKGROUND' }, [{ ...highEnergy, energy: 'HIGH' }]);
    expect(denied.primary).toBeUndefined();
    optimizer.setResourceProfile('BALANCED');
    expect(optimizer.select('metered', { profile: 'BACKGROUND' }, [{ ...highEnergy, energy: 'HIGH' }]).primary).toBeDefined();

    const runtime: AIModelRuntime = { model: MODEL, async infer<T>(input: unknown): Promise<T> { return input as T; } };
    const scheduler = new AIResourceScheduler({ runtimeFactory: () => runtime, mode: 'BATTERY', budget: { maxQueuedJobs: 4 } });
    const background = await scheduler.enqueue({ agentId: 'background', model: MODEL, priority: 'BACKGROUND', kind: 'profile', handler: async () => 'not-run' });
    expect(background.state).toBe('paused');
    scheduler.close();
    await waitFor(() => true, 10);
  });
});
