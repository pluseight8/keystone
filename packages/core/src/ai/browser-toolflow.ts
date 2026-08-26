/**
 * Typed BrowserAgentRuntime tools for ToolFlow.  The adapter intentionally
 * exposes a small set of semantic operations; it does not expose DOM
 * selectors, JavaScript evaluation, cookies, credentials or filesystem paths.
 */

import { z } from 'zod';
import {
  BrowserAgentRuntime,
  type BrowserActionResult,
  type BrowserArtifact,
  type BrowserContext,
  type BrowserPageDataClass,
  type BrowserTabState,
} from '@keystone/browser-engine';
import type { AIDataClass } from './privacy.js';
import {
  ToolRegistry,
  type Tool,
  type ToolExecutionContext,
} from './tools.js';

export const BROWSER_TOOLFLOW_TOOL_IDS = ['browser.openTab', 'browser.observe', 'browser.navigate', 'browser.createArtifact'] as const;

const sessionIdSchema = z.string().min(1).max(256);
const tabIdSchema = z.string().min(1).max(256).optional();
const openTabSchema = z.object({ sessionId: sessionIdSchema, url: z.string().url().max(2_048), title: z.string().max(120).optional() }).strict();
const observeSchema = z.object({ sessionId: sessionIdSchema, tabId: tabIdSchema }).strict();
const navigateSchema = z.object({ sessionId: sessionIdSchema, tabId: sessionIdSchema.optional(), url: z.string().url().max(2_048), expectedPageRevision: z.number().int().positive().optional() }).strict();
const createArtifactSchema = z.object({ sessionId: sessionIdSchema, tabId: tabIdSchema, extractedData: z.unknown(), citations: z.array(z.object({ quote: z.string().max(2_048).optional(), locator: z.string().max(512).optional(), elementId: z.string().max(256).optional() }).strict()).max(128).optional(), fileRefs: z.array(z.string().min(1).max(512)).max(128).optional(), screenshotRef: z.string().max(512).optional() }).strict();

export interface BrowserToolFlowAdapterOptions {
  readonly runtime: BrowserAgentRuntime;
}

function browserClass(value: unknown): AIDataClass {
  const candidate = value as { dataClass?: unknown; page?: { dataClass?: unknown }; provenance?: { execution?: unknown } } | undefined;
  const dataClass = candidate?.dataClass ?? candidate?.page?.dataClass;
  return dataClass === 'SECRET' || dataClass === 'PRIVATE' || dataClass === 'USER_EXPLICIT' || dataClass === 'PUBLIC' ? dataClass : 'PUBLIC';
}

function tool<I, O>(input: Pick<Tool<I, O>, 'id' | 'name' | 'description' | 'capabilities' | 'inputSchema' | 'outputSchema' | 'resultClass' | 'execute'>): Tool<unknown, unknown> {
  return { version: 1, ...input } as unknown as Tool<unknown, unknown>;
}

export class BrowserToolFlowAdapter {
  readonly runtime: BrowserAgentRuntime;
  constructor(options: BrowserToolFlowAdapterOptions) { this.runtime = options.runtime; }

  createTools(): readonly Tool[] {
    const runtime = this.runtime;
    return [
      tool({
        id: 'browser.openTab',
        name: 'Open a browser tab',
        description: 'Open an HTTP(S) tab within the existing bounded BrowserAgentRuntime session.',
        capabilities: ['DEVICE_ACTION'],
        inputSchema: openTabSchema,
        outputSchema: z.custom<BrowserTabState>(),
        resultClass: (value: unknown) => browserClass(value),
        execute: async (input, _context) => runtime.openTab(input.sessionId, input.url, input.title),
      }),
      tool({
        id: 'browser.observe',
        name: 'Observe a browser page',
        description: 'Return the bounded, untrusted BrowserContext for a tab.',
        capabilities: ['READ_PRIVATE'],
        inputSchema: observeSchema,
        outputSchema: z.custom<BrowserContext>(),
        resultClass: (value: unknown) => browserClass(value),
        execute: async (input, _context) => runtime.getContext(input.sessionId, input.tabId),
      }),
      tool({
        id: 'browser.navigate',
        name: 'Navigate a browser tab',
        description: 'Navigate through BrowserAgentRuntime origin, revision and policy checks.',
        capabilities: ['DEVICE_ACTION'],
        inputSchema: navigateSchema,
        outputSchema: z.custom<BrowserActionResult>(),
        resultClass: (value: unknown) => browserClass(value),
        execute: async (input, _context) => runtime.executeIntent(input.sessionId, { type: 'NAVIGATE', tabId: input.tabId, url: input.url, expectedPageRevision: input.expectedPageRevision }),
      }),
      tool({
        id: 'browser.createArtifact',
        name: 'Create a browser artifact',
        description: 'Create an integrity-checked, untrusted BrowserArtifact through the existing runtime boundary.',
        capabilities: ['READ_PRIVATE'],
        inputSchema: createArtifactSchema,
        outputSchema: z.custom<BrowserArtifact>(),
        resultClass: (value: unknown) => browserClass(value),
        execute: async (input, _context) => { const { sessionId, ...artifactInput } = input; return runtime.createArtifact(sessionId, artifactInput as { readonly tabId?: string; readonly extractedData: unknown; readonly citations?: readonly { readonly quote?: string; readonly locator?: string; readonly elementId?: string }[]; readonly fileRefs?: readonly string[]; readonly screenshotRef?: string }); },
      }),
    ];
  }

  register(registry: ToolRegistry): readonly Tool[] {
    const tools = this.createTools();
    registry.registerMany(tools);
    return tools;
  }
}

export function createBrowserToolFlowTools(options: BrowserToolFlowAdapterOptions): readonly Tool[] { return new BrowserToolFlowAdapter(options).createTools(); }
export function registerBrowserToolFlowTools(registry: ToolRegistry, options: BrowserToolFlowAdapterOptions): readonly Tool[] { return new BrowserToolFlowAdapter(options).register(registry); }
