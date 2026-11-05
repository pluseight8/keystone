import { describe, expect, it } from 'vitest';
import { createDesktopAIConversation, readDesktopAIConversations, writeDesktopAIConversations } from './desktop-ai-conversations';

class StateStore {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('desktop local AI conversations', () => {
  it('round-trips bounded owner-scoped conversation state', () => {
    const storage = new StateStore();
    const conversation = createDesktopAIConversation('Local test');
    const value = { ...conversation, messages: [{ id: 'message-1', role: 'user' as const, text: 'hello', createdAt: new Date().toISOString() }] };
    writeDesktopAIConversations('owner-a', [value], storage);
    expect(readDesktopAIConversations('owner-a', storage)).toEqual([value]);
    expect(readDesktopAIConversations('owner-b', storage)).toEqual([]);
  });
});
