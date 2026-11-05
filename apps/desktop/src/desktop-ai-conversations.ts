export type DesktopAIConversationRole = 'user' | 'assistant';

export interface DesktopAIConversationMessage {
  readonly id: string;
  readonly role: DesktopAIConversationRole;
  readonly text: string;
  readonly createdAt: string;
}

export interface DesktopAIConversation {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly messages: readonly DesktopAIConversationMessage[];
}

export interface DesktopAIConversationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MAX_CONVERSATIONS = 32;
const MAX_MESSAGES = 64;
const MAX_TEXT = 100_000;

export function desktopAIConversationKey(ownerIdentityId: string): string {
  return `keystone.local.ai-conversations.v1:${ownerIdentityId}`;
}

export function createDesktopAIConversation(title = 'New conversation'): DesktopAIConversation {
  const timestamp = new Date().toISOString();
  const random = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id: `ai-conversation:${random}`, title: title.trim().slice(0, 120) || 'New conversation', updatedAt: timestamp, messages: [] };
}

export function readDesktopAIConversations(ownerIdentityId: string, storage?: DesktopAIConversationStorage): readonly DesktopAIConversation[] {
  const source = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!source) return [];
  try {
    const raw = source.getItem(desktopAIConversationKey(ownerIdentityId));
    const value = raw ? JSON.parse(raw) : undefined;
    if (!Array.isArray(value)) return [];
    return value.flatMap(parseConversation).slice(0, MAX_CONVERSATIONS);
  } catch {
    return [];
  }
}

export function writeDesktopAIConversations(ownerIdentityId: string, conversations: readonly DesktopAIConversation[], storage?: DesktopAIConversationStorage): void {
  const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!target) throw new Error('AI conversation storage is unavailable');
  const value = conversations.slice(0, MAX_CONVERSATIONS).map(normalizeConversation);
  try { target.setItem(desktopAIConversationKey(ownerIdentityId), JSON.stringify(value)); }
  catch { throw new Error('AI conversations could not be persisted'); }
}

function parseConversation(value: unknown): DesktopAIConversation[] {
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.updatedAt !== 'string' || !Array.isArray(row.messages)) return [];
  const messages = row.messages.flatMap(parseMessage).slice(-MAX_MESSAGES);
  return [{ id: row.id.slice(0, 160), title: row.title.slice(0, 120), updatedAt: row.updatedAt, messages }];
}

function parseMessage(value: unknown): DesktopAIConversationMessage[] {
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || (row.role !== 'user' && row.role !== 'assistant') || typeof row.text !== 'string' || typeof row.createdAt !== 'string') return [];
  return [{ id: row.id.slice(0, 160), role: row.role, text: row.text.slice(0, MAX_TEXT), createdAt: row.createdAt }];
}

function normalizeConversation(value: DesktopAIConversation): DesktopAIConversation {
  return { id: value.id.slice(0, 160), title: value.title.slice(0, 120), updatedAt: value.updatedAt, messages: value.messages.slice(-MAX_MESSAGES).map(message => ({ id: message.id.slice(0, 160), role: message.role, text: message.text.slice(0, MAX_TEXT), createdAt: message.createdAt })) };
}
