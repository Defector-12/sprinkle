import type { ChatMessage, PageContext } from '../core/types.ts';
import { createPageKey, normalizePageUrl } from '../core/url.ts';

const CONTEXT_PREFIX = 'context-reader:context:';
const CONVERSATION_PREFIX = 'context-reader:conversation:';

export interface StorageArea {
  get(keys: null | string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function contextStorageKey(tabId: number, url: string): string {
  return `${CONTEXT_PREFIX}${createPageKey(tabId, url)}`;
}

function isPageContext(value: unknown): value is PageContext {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PageContext>;
  return (
    typeof candidate.key === 'string' &&
    typeof candidate.tabId === 'number' &&
    typeof candidate.normalizedUrl === 'string' &&
    Array.isArray(candidate.messages)
  );
}

export class SessionContextRepository {
  constructor(private readonly storage: StorageArea) {}

  async get(tabId: number, url: string): Promise<PageContext | null> {
    const key = contextStorageKey(tabId, url);
    const result = await this.storage.get(key);
    return isPageContext(result[key]) ? result[key] : null;
  }

  async save(context: PageContext): Promise<void> {
    await this.storage.set({
      [contextStorageKey(context.tabId, context.url)]: context,
    });
  }

  async listForTab(tabId: number): Promise<PageContext[]> {
    const values = await this.storage.get(null);
    return Object.entries(values)
      .filter(([key]) => key.startsWith(CONTEXT_PREFIX))
      .map(([, value]) => value)
      .filter(isPageContext)
      .filter((context) => context.tabId === tabId);
  }

  async deletePage(tabId: number, url: string): Promise<void> {
    await this.storage.remove(contextStorageKey(tabId, url));
  }

  async deleteTab(tabId: number): Promise<void> {
    const contexts = await this.listForTab(tabId);
    if (!contexts.length) return;
    await this.storage.remove(
      contexts.map((context) => contextStorageKey(tabId, context.url)),
    );
  }
}

interface ArchivedConversation {
  normalizedUrl: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

function conversationStorageKey(url: string): string {
  return `${CONVERSATION_PREFIX}${normalizePageUrl(url)}`;
}

function isArchivedConversation(value: unknown): value is ArchivedConversation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ArchivedConversation>;
  return (
    typeof candidate.normalizedUrl === 'string' &&
    Array.isArray(candidate.messages)
  );
}

export class ConversationArchive {
  constructor(private readonly storage: StorageArea) {}

  async save(context: PageContext): Promise<void> {
    const conversation: ArchivedConversation = {
      normalizedUrl: context.normalizedUrl,
      title: context.title,
      messages: context.messages,
      updatedAt: Date.now(),
    };
    await this.storage.set({
      [conversationStorageKey(context.url)]: conversation,
    });
  }

  async load(url: string): Promise<ChatMessage[]> {
    const key = conversationStorageKey(url);
    const result = await this.storage.get(key);
    const conversation = result[key];
    return isArchivedConversation(conversation)
      ? conversation.messages
      : [];
  }

  async delete(url: string): Promise<void> {
    await this.storage.remove(conversationStorageKey(url));
  }

  async clear(): Promise<void> {
    const values = await this.storage.get(null);
    const keys = Object.keys(values).filter((key) =>
      key.startsWith(CONVERSATION_PREFIX),
    );
    if (keys.length) await this.storage.remove(keys);
  }
}
