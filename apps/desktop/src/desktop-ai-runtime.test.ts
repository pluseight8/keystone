import { describe, expect, it, vi } from 'vitest';
import { AISettingsService } from '@keystone/core';
import { createDesktopAIRuntime } from './desktop-ai-runtime';

class StateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

describe('desktop local AI runtime', () => {
  it('keeps provider configuration local-only and rejects remote endpoints', async () => {
    const settings = new AISettingsService(new StateStore());
    const runtime = createDesktopAIRuntime(settings);
    await runtime.ready();

    const next = await runtime.configureLocalProvider({ kind: 'lm-studio', endpoint: 'http://127.0.0.1:1234/v1/chat/completions', model: 'qwen2.5' });
    expect(next.remoteEnabled).toBe(false);
    expect(next.personalTarget).toBe('this-device');
    expect(next.models[0]).toMatchObject({ scope: 'local', endpoint: 'http://127.0.0.1:1234/v1/chat/completions' });
    expect(runtime.providerKind()).toBe('lm-studio');

    await expect(runtime.configureLocalProvider({ kind: 'openai-compatible', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'remote' })).rejects.toThrow('localhost');
    await expect(runtime.configureLocalProvider({ kind: 'llama.cpp', model: 'local' })).rejects.toThrow('native local model host');
  });

  it('clears local provider metadata without introducing a fallback', async () => {
    const settings = new AISettingsService(new StateStore());
    const runtime = createDesktopAIRuntime(settings);
    await runtime.ready();
    await runtime.configureLocalProvider({ kind: 'ollama', model: 'llama3.2' });
    const cleared = await runtime.clearLocalProvider();
    expect(cleared.models).toHaveLength(0);
    expect(cleared.defaultModel).toBeNull();
    expect(cleared.remoteEnabled).toBe(false);
    expect(runtime.providerKind()).toBeUndefined();
  });

  it('discovers models through the configured localhost API only', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://127.0.0.1:1234/v1/models');
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'qwen2.5', owned_by: 'lm-studio' }, { id: 'bad model' }] }) } as Response;
    });
    vi.stubGlobal('fetch', fetch);
    try {
      const runtime = createDesktopAIRuntime(new AISettingsService(new StateStore()));
      await runtime.ready();
      await runtime.configureLocalProvider({ kind: 'lm-studio', endpoint: 'http://127.0.0.1:1234/v1/chat/completions', model: 'qwen2.5' });
      await expect(runtime.discoverModels()).resolves.toEqual([{ model: 'qwen2.5', displayName: 'qwen2.5', ownedBy: 'lm-studio' }]);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('restores the persisted local provider after a desktop restart', async () => {
    const store = new StateStore();
    const first = createDesktopAIRuntime(new AISettingsService(store));
    await first.ready();
    await first.configureLocalProvider({ kind: 'lm-studio', endpoint: 'http://127.0.0.1:1234/v1/chat/completions', model: 'qwen2.5' });

    const restarted = createDesktopAIRuntime(new AISettingsService(store));
    await restarted.ready();

    expect(restarted.providerKind()).toBe('lm-studio');
    expect(restarted.router.listModels().map(item => item.ref)).toContainEqual({ provider: 'lm-studio', model: 'qwen2.5' });
    expect(restarted.settings.snapshot().remoteEnabled).toBe(false);
  });

  it('discovers models of a draft source before it is saved, and only on localhost', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'qwen2.5' }, { id: 'org/model@q4_k_m' }, { id: '../etc' }] }) }) as Response);
    vi.stubGlobal('fetch', fetch);
    try {
      const runtime = createDesktopAIRuntime(new AISettingsService(new StateStore()));
      await runtime.ready();
      expect(runtime.providerKind()).toBeUndefined();
      await expect(runtime.discoverModels({ kind: 'lm-studio', endpoint: 'http://127.0.0.1:1234/v1/chat/completions' })).resolves.toEqual([{ model: 'qwen2.5', displayName: 'qwen2.5' }, { model: 'org/model@q4_k_m', displayName: 'org/model@q4_k_m' }]);
      expect(String(fetch.mock.calls[0]![0])).toBe('http://127.0.0.1:1234/v1/models');
      await expect(runtime.discoverModels({ kind: 'openai-compatible', endpoint: 'https://example.org/v1/chat/completions' })).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
