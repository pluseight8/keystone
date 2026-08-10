import * as Y from 'yjs';
import { z } from 'zod';
import type { LlamaCppAdapter } from './llama-cpp.js';

const title = z.string().trim().min(1).max(240);
const taskSchema = z.object({
  title,
  estimateMinutes: z.number().int().min(5).max(10_080),
}).strict();
const projectSchema = z.object({
  title,
  tasks: z.array(taskSchema).min(1).max(30),
  resources: z.array(z.never()).length(0),
}).strict();
export const architectPlanSchema = z.object({
  goal: z.object({ title, projects: z.array(projectSchema).min(1).max(20) }).strict(),
}).strict();

export type ArchitectPlan = z.infer<typeof architectPlanSchema>;
export interface ArchitectNode {
  id: string;
  type: 'goal' | 'project' | 'task' | 'folder';
  title: string;
  position: { x: number; y: number };
  estimateMinutes?: number;
  folderKind?: 'resources';
  createdAt: string;
}
export interface ArchitectEdge { id: string; source: string; target: string; label: 'contains' }
export interface ArchitectDeployment { rootId: string; nodeIds: string[]; edgeIds: string[]; plan: ArchitectPlan }

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['goal'],
  properties: { goal: {
    type: 'object', additionalProperties: false, required: ['title', 'projects'],
    properties: {
      title: { type: 'string' },
      projects: { type: 'array', minItems: 1, maxItems: 20, items: {
        type: 'object', additionalProperties: false, required: ['title', 'tasks', 'resources'],
        properties: {
          title: { type: 'string' }, resources: { type: 'array', maxItems: 0 },
          tasks: { type: 'array', minItems: 1, maxItems: 30, items: {
            type: 'object', additionalProperties: false, required: ['title', 'estimateMinutes'],
            properties: { title: { type: 'string' }, estimateMinutes: { type: 'integer', minimum: 5, maximum: 10_080 } },
          } },
        },
      } },
    },
  } },
} as const;

export const ARCHITECT_SYSTEM_PROMPT = `You are Keystone Project Architect. Convert one user goal into a practical hierarchy. Projects are meaningful workstreams; tasks are atomic, actionable and independently completable. Estimate every task in minutes. Include exactly one empty resources array per project. Do not add prose, markdown, personal data, or properties outside the schema. Return ONLY valid JSON matching this schema: ${JSON.stringify(PLAN_SCHEMA)}`;

/** Generates a bounded, strictly validated project plan with the selected local llama.cpp model. */
export async function architectProject(adapter: LlamaCppAdapter, request: string, signal?: AbortSignal): Promise<ArchitectPlan> {
  const goal = request.trim();
  if (!goal) throw new Error('Project goal is empty');
  if (goal.length > 2_000) throw new Error('Project goal is too long');
  let output = '';
  for await (const token of adapter.stream({ system: ARCHITECT_SYSTEM_PROMPT, prompt: goal, temperature: 0, maxTokens: 4_096, signal })) output += token;
  let value: unknown;
  try { value = JSON.parse(extractJsonObject(output)); } catch { throw new Error('AI Architect returned invalid JSON'); }
  const parsed = architectPlanSchema.safeParse(value);
  if (!parsed.success) throw new Error(`AI Architect returned an invalid project plan: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`);
  return parsed.data;
}

/** Atomically materializes a validated plan into the canonical Life Map Y.Maps. */
export function deployArchitectPlan(document: Y.Doc, planInput: ArchitectPlan, options: { now?: Date; id?: () => string } = {}): ArchitectDeployment {
  const plan = architectPlanSchema.parse(planInput);
  const lifeMap = document.getMap<unknown>('lifeMap');
  let nodes: Y.Map<unknown>; let edges: Y.Map<unknown>;
  const makeId = options.id ?? (() => crypto.randomUUID());
  const createdAt = (options.now ?? new Date()).toISOString();
  const nodeIds: string[] = []; const edgeIds: string[] = [];
  const addNode = (node: Omit<ArchitectNode, 'id' | 'createdAt'>): string => { const id = uniqueId(makeId, nodes, nodeIds); nodeIds.push(id); nodes.set(id, { id, ...node, createdAt } satisfies ArchitectNode); return id; };
  const addEdge = (source: string, target: string): void => { const id = uniqueId(makeId, edges, edgeIds); edgeIds.push(id); edges.set(id, { id, source, target, label: 'contains' } satisfies ArchitectEdge); };
  let rootId = '';
  document.transact(() => {
    nodes = ensureCollection(lifeMap, 'nodes'); edges = ensureCollection(lifeMap, 'edges');
    rootId = addNode({ type: 'goal', title: plan.goal.title, position: { x: 40, y: 220 } });
    plan.goal.projects.forEach((project, projectIndex) => {
      const x = 320 + projectIndex * 280;
      const projectId = addNode({ type: 'project', title: project.title, position: { x, y: 120 } }); addEdge(rootId, projectId);
      project.tasks.forEach((task, taskIndex) => { const taskId = addNode({ type: 'task', title: task.title, estimateMinutes: task.estimateMinutes, position: { x, y: 280 + taskIndex * 116 } }); addEdge(projectId, taskId); });
      const resourcesId = addNode({ type: 'folder', folderKind: 'resources', title: 'Resources', position: { x, y: 280 + project.tasks.length * 116 } }); addEdge(projectId, resourcesId);
    });
  }, 'ai-project-architect');
  return { rootId, nodeIds, edgeIds, plan };
}

export async function architectAndDeploy(adapter: LlamaCppAdapter, document: Y.Doc, request: string, signal?: AbortSignal): Promise<ArchitectDeployment> {
  return deployArchitectPlan(document, await architectProject(adapter, request, signal));
}

function ensureCollection(parent: Y.Map<unknown>, key: string): Y.Map<unknown> { const value = parent.get(key); if (value instanceof Y.Map) return value; const map = new Y.Map<unknown>(); parent.set(key, map); return map; }
function uniqueId(makeId: () => string, collection: Y.Map<unknown>, pending: readonly string[]): string { for (let attempt = 0; attempt < 100; attempt += 1) { const id = makeId(); if (id && !collection.has(id) && !pending.includes(id)) return id; } throw new Error('Unable to allocate a unique Life Map id'); }
function extractJsonObject(text: string): string { const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]; const input = fenced?.trim() ?? text.trim(); const start = input.indexOf('{'); const end = input.lastIndexOf('}'); if (start < 0 || end < start) throw new Error('No JSON object'); return input.slice(start, end + 1); }
