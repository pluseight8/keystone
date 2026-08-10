import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { LocalHashEmbeddingProvider, RAGManager, type EmbeddingProvider } from './rag.js';
import { createPersonalEcosystemDocument } from './sync/crdt.js';

describe('RAGManager', () => {
  it('searches locally and observes nested CRDT updates', async () => {
    const ydoc = new Y.Doc();
    const ecosystem = createPersonalEcosystemDocument(ydoc);
    const nodes = ecosystem.lifeMap.get('nodes') as Y.Map<unknown>;
    nodes.set('project', { title: 'Garden irrigation', summary: 'Install a rainwater pump', secret: 'never index this', settings: { password: 'also private', color: 'green' } });

    const rag = new RAGManager({ embedder: new LocalHashEmbeddingProvider(64) });
    await rag.rebuild(ydoc);
    expect(rag.size()).toBe(1);
    expect((await rag.search('rainwater'))[0]).toMatchObject({ id: 'node:project', type: 'node' });
    expect((await rag.search('rainwater'))[0]?.metadata).not.toHaveProperty('secret');
    expect((await rag.search('rainwater'))[0]?.metadata).toMatchObject({ settings: { color: 'green' } });

    const detach = rag.attach(ydoc);
    ecosystem.notes.set('shopping', { title: 'Hardware list', body: 'brass connector' });
    await vi.waitFor(() => expect(rag.size()).toBe(2));
    expect((await rag.search('connector'))[0]?.id).toBe('note:shopping');
    detach();
  });

  it('uses the hash fallback only when enabled', async () => {
    const unavailable: EmbeddingProvider = { async embed() { throw new Error('model unavailable'); } };
    const fallback = new RAGManager({ embedder: unavailable });
    await expect(fallback.upsert({ id: 'one', type: 'note', text: 'offline', metadata: {} })).resolves.toBeUndefined();

    const strict = new RAGManager({ embedder: unavailable, fallbackToHash: false });
    await expect(strict.upsert({ id: 'one', type: 'note', text: 'offline', metadata: {} })).rejects.toThrow('model unavailable');
  });
});
