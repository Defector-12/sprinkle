import type {
  ArchivedConversation,
  ChatMessage,
  ConversationArchiveUsage,
  ConversationSummary,
  PageContext,
} from '../core/types.ts';
import { createPageKey, normalizePageUrl } from '../core/url.ts';

const CONTEXT_PREFIX = 'context-reader:context:';
const CONVERSATION_PREFIX = 'context-reader:conversation:';
const LOCAL_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024;

export interface StorageArea {
  get(keys: null | string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  getBytesInUse?(keys?: null | string | string[]): Promise<number>;
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
    return (await this.listAll()).filter((context) => context.tabId === tabId);
  }

  async listAll(): Promise<PageContext[]> {
    const values = await this.storage.get(null);
    return Object.entries(values)
      .filter(([key]) => key.startsWith(CONTEXT_PREFIX))
      .map(([, value]) => value)
      .filter(isPageContext);
  }

  async listForUrl(url: string): Promise<PageContext[]> {
    const normalizedUrl = normalizePageUrl(url);
    return (await this.listAll()).filter(
      (context) => context.normalizedUrl === normalizedUrl,
    );
  }

  async replaceMessagesForUrl(
    url: string,
    messages: ChatMessage[],
  ): Promise<PageContext[]> {
    const matching = await this.listForUrl(url);
    const updated = matching.map((context) => ({
      ...context,
      messages,
      updatedAt: Date.now(),
    }));
    if (updated.length) {
      await this.storage.set(
        Object.fromEntries(
          updated.map((context) => [
            contextStorageKey(context.tabId, context.url),
            context,
          ]),
        ),
      );
    }
    return updated;
  }

  async clearAllMessages(): Promise<PageContext[]> {
    const updated = (await this.listAll())
      .filter((context) => context.messages.length > 0)
      .map((context) => ({
        ...context,
        messages: [],
        updatedAt: Date.now(),
      }));
    if (updated.length) {
      await this.storage.set(
        Object.fromEntries(
          updated.map((context) => [
            contextStorageKey(context.tabId, context.url),
            context,
          ]),
        ),
      );
    }
    return updated;
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

function conversationStorageKey(url: string): string {
  return `${CONVERSATION_PREFIX}${normalizePageUrl(url)}`;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ChatMessage>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'number'
  );
}

function completeTurns(messages: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const question = messages[index];
    const answer = messages[index + 1];
    if (
      question?.role !== 'user' ||
      answer?.role !== 'assistant' ||
      question.error ||
      answer.error
    ) {
      continue;
    }
    turns.push([question, answer]);
    index += 1;
  }
  return turns;
}

function archiveMessage(message: ChatMessage): ChatMessage {
  const reference = message.reference;
  if (!reference || reference.type === 'text' || !reference.imageUrl) {
    return message;
  }
  const { imageUrl: _imageUrl, ...metadata } = reference;
  return { ...message, reference: metadata };
}

function archivedMessages(messages: ChatMessage[]): ChatMessage[] {
  return completeTurns(messages).flat().map(archiveMessage);
}

function normalizedConversation(
  value: unknown,
): ArchivedConversation | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ArchivedConversation>;
  if (
    typeof candidate.normalizedUrl !== 'string' ||
    !Array.isArray(candidate.messages)
  ) {
    return null;
  }
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizePageUrl(candidate.normalizedUrl);
  } catch {
    return null;
  }
  const messages = archivedMessages(candidate.messages.filter(isChatMessage));
  if (!messages.length) return null;
  const firstMessageAt = messages[0]?.createdAt ?? Date.now();
  return {
    schemaVersion: 2,
    normalizedUrl,
    title:
      typeof candidate.title === 'string' && candidate.title.trim()
        ? candidate.title
        : new URL(normalizedUrl).hostname,
    messages,
    createdAt:
      typeof candidate.createdAt === 'number'
        ? candidate.createdAt
        : firstMessageAt,
    updatedAt:
      typeof candidate.updatedAt === 'number'
        ? candidate.updatedAt
        : messages.at(-1)?.createdAt ?? firstMessageAt,
  };
}

export function mergeConversationMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const turns = new Map<string, ChatMessage[]>();
  for (const turn of [
    ...completeTurns(existing),
    ...completeTurns(incoming),
  ]) {
    const question = turn[0];
    if (question) turns.set(question.id, turn.map(archiveMessage));
  }
  return [...turns.values()]
    .sort(
      (left, right) =>
        (left[0]?.createdAt ?? 0) - (right[0]?.createdAt ?? 0),
    )
    .flat();
}

export class ConversationArchive {
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly storage: StorageArea) {}

  async save(context: PageContext): Promise<void> {
    const key = conversationStorageKey(context.url);
    const previous = this.writeQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const incoming = archivedMessages(context.messages);
      if (!incoming.length) return;
      const existing = await this.get(context.url);
      const messages = mergeConversationMessages(
        existing?.messages ?? [],
        incoming,
      );
      const conversation: ArchivedConversation = {
        schemaVersion: 2,
        normalizedUrl: context.normalizedUrl,
        title: context.title,
        messages,
        createdAt:
          existing?.createdAt ?? messages[0]?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      await this.storage.set({ [key]: conversation });
    });
    this.writeQueues.set(key, next);
    try {
      await next;
    } finally {
      if (this.writeQueues.get(key) === next) this.writeQueues.delete(key);
    }
  }

  async get(url: string): Promise<ArchivedConversation | null> {
    const key = conversationStorageKey(url);
    const result = await this.storage.get(key);
    return normalizedConversation(result[key]);
  }

  async load(url: string): Promise<ChatMessage[]> {
    return (await this.get(url))?.messages ?? [];
  }

  async list(query = ''): Promise<ConversationSummary[]> {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const values = await this.storage.get(null);
    return Object.entries(values)
      .filter(([key]) => key.startsWith(CONVERSATION_PREFIX))
      .map(([, value]) => normalizedConversation(value))
      .filter(
        (conversation): conversation is ArchivedConversation =>
          conversation !== null,
      )
      .filter((conversation) => {
        if (!normalizedQuery) return true;
        return [
          conversation.title,
          conversation.normalizedUrl,
          ...conversation.messages.map((message) => message.content),
        ]
          .join('\n')
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      })
      .map((conversation) => {
        const questions = conversation.messages.filter(
          (message) => message.role === 'user',
        );
        return {
          normalizedUrl: conversation.normalizedUrl,
          title: conversation.title,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          questionCount: questions.length,
          lastQuestion: questions.at(-1)?.content ?? '',
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async usage(): Promise<ConversationArchiveUsage> {
    const bytesInUse = this.storage.getBytesInUse
      ? await this.storage.getBytesInUse(null)
      : new TextEncoder().encode(
          JSON.stringify(await this.storage.get(null)),
        ).byteLength;
    return { bytesInUse, quotaBytes: LOCAL_STORAGE_QUOTA_BYTES };
  }

  async delete(url: string): Promise<void> {
    const key = conversationStorageKey(url);
    await (this.writeQueues.get(key) ?? Promise.resolve()).catch(
      () => undefined,
    );
    await this.storage.remove(key);
  }

  async clear(): Promise<void> {
    await Promise.all(
      [...this.writeQueues.values()].map((pending) =>
        pending.catch(() => undefined),
      ),
    );
    const values = await this.storage.get(null);
    const keys = Object.keys(values).filter((key) =>
      key.startsWith(CONVERSATION_PREFIX),
    );
    if (keys.length) await this.storage.remove(keys);
  }
}
