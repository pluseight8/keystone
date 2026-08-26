import { describe, expect, it } from 'vitest';
import { TaskService } from '../tasks.js';
import { CaptureService, createCaptureDestinationRegistry } from '../capture.js';

describe('R0P94 canonical destination integration', () => {
  it('creates a real Task only through the explicit Capture destination adapter', async () => {
    const tasks = new TaskService({ identityId: 'capture-integration-owner' });
    const capture = new CaptureService({ ownerIdentityId: 'capture-integration-owner', destinations: createCaptureDestinationRegistry({
      task: { create: async ({ item }) => { const text = item.payload.kind === 'TEXT' ? item.payload.text : item.title; const task = await tasks.createTask({ title: text }); return { type: 'task', id: task.id, label: task.title, dataClass: 'PRIVATE' }; } },
    }) });
    const item = await capture.captureText({ text: 'todo: reconcile canonical storage', source: { kind: 'MANUAL' } });
    expect((await capture.list({ state: 'READY' })).total).toBe(1);
    const result = await capture.route(item.id, 'TASK', { ownerConfirmed: true });
    expect(tasks.getTask(result.reference.id).title).toBe('todo: reconcile canonical storage');
    expect((await capture.get(item.id))?.resultRefs[0]).toMatchObject({ type: 'task', id: result.reference.id });
  });

  it('keeps canonical writer bytes outside the Capture state store', async () => {
    let writes = 0;
    const capture = new CaptureService({ destinations: createCaptureDestinationRegistry({ files: { create: async ({ item, readFile }) => { const file = item.payload.kind === 'FILE' ? item.payload.file : undefined; expect(file).toBeDefined(); const content = await readFile(file!.id); writes += content.byteLength; return { type: 'file', id: 'canonical-file-1', dataClass: 'PRIVATE' }; } } }) });
    const item = await capture.captureFile({ name: 'payload.bin', mimeType: 'application/octet-stream', bytes: new Uint8Array([1, 2, 3]) });
    await capture.route(item.id, 'FILES', { ownerConfirmed: true });
    expect(writes).toBe(3);
  });
});
