import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { deployArchitectPlan } from './architect.js';

describe('AI Project Architect', () => {
  it('deploys goal, projects, atomic tasks and resource folders in one Yjs transaction', () => {
    const doc = new Y.Doc(); let updates = 0; doc.on('update', () => { updates += 1; }); let id = 0;
    const deployed = deployArchitectPlan(doc, { goal: { title: 'Exam', projects: [{ title: 'Math', tasks: [{ title: 'Solve set', estimateMinutes: 45 }], resources: [] }] } }, { id: () => `id-${++id}`, now: new Date('2026-01-01T00:00:00Z') });
    const nodes = doc.getMap('lifeMap').get('nodes') as Y.Map<Record<string, unknown>>;
    const edges = doc.getMap('lifeMap').get('edges') as Y.Map<Record<string, unknown>>;
    expect(updates).toBe(1); expect(nodes.size).toBe(4); expect(edges.size).toBe(3);
    expect(deployed.nodeIds.map(nodeId => nodes.get(nodeId)?.type)).toEqual(['goal', 'project', 'task', 'folder']);
    expect(nodes.get(deployed.nodeIds[2])?.estimateMinutes).toBe(45);
  });
});
