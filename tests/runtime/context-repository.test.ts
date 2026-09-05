import { describe, expect, it } from 'vitest';

import {
  ConversationArchive,
  SessionContextRepository,
  type StorageArea,
} from '../../src/runtime/context-repository.ts';
import type { PageContext } from '../../src/core/types.ts';

class MemoryStorage implements StorageArea {
  readonly values: Record<string, unknown> = {};

  async get(keys: null | string | string[]) {
    if (keys === null) return { ...this.values };
    const requestedKeys = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      requestedKeys
        .filter((key) => key in this.values)
        .map((key) => [key, this.values[key]]),
    );
  }

  async set(items: Record<string, unknown>) {
    Object.assign(this.values, items);
  }

  async remove(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete this.values[key];
    }
  }

  async getBytesInUse() {
    return new TextEncoder().encode(JSON.stringify(this.values)).byteLength;
  }
}

function createContext(tabId: number, url: string): PageContext {
  return {
    key: `${tabId}:${url}`,
    tabId,
    url,
    normalizedUrl: url,
    title: 'Article',
    status: 'ready',
    article: {
      title: 'Article',
      url,
      blocks: [],
      images: [],
      isPartial: false,
    },
    focus: null,
    messages: [
      {
        id: 'message',
        role: 'user',
        content: 'Question',
        createdAt: 1,
      },
    ],
    warning: null,
    updatedAt: 1,
  };
}

describe('SessionContextRepository', () => {
  it('stores and restores contexts by tab and normalized URL', async () => {
    const storage = new MemoryStorage();
    const repository = new SessionContextRepository(storage);
    const context = createContext(4, 'https://example.com/article');

    await repository.save(context);

    await expect(repository.get(4, context.url)).resolves.toEqual(context);
  });

  it('deletes every context from a closed tab without touching other tabs', async () => {
    const storage = new MemoryStorage();
    const repository = new SessionContextRepository(storage);
    await repository.save(createContext(4, 'https://example.com/one'));
    await repository.save(createContext(4, 'https://example.com/two'));
    await repository.save(createContext(5, 'https://example.com/one'));

    await repository.deleteTab(4);

    await expect(repository.listForTab(4)).resolves.toEqual([]);
    await expect(repository.listForTab(5)).resolves.toHaveLength(1);
  });

  it('ignores malformed values and supports deleting a single page', async () => {
    const storage = new MemoryStorage();
    const repository = new SessionContextRepository(storage);
    const context = createContext(4, 'https://example.com/article');
    storage.values['context-reader:context:invalid'] = { tabId: 4 };
    await repository.save(context);

    expect(await repository.listForTab(4)).toEqual([context]);
    await repository.deletePage(4, context.url);
    await expect(repository.get(4, context.url)).resolves.toBeNull();
  });

  it('does not issue a remove call when a tab has no contexts', async () => {
    const storage = new MemoryStorage();
    const repository = new SessionContextRepository(storage);

    await repository.deleteTab(99);

    expect(storage.values).toEqual({});
  });

  it('clears messages for every context matching a normalized URL', async () => {
    const storage = new MemoryStorage();
    const repository = new SessionContextRepository(storage);
    await repository.save(createContext(4, 'https://example.com/article'));
    await repository.save({
      ...createContext(5, 'https://example.com/article/'),
      normalizedUrl: 'https://example.com/article',
    });
    await repository.save(createContext(6, 'https://example.com/other'));

    const updated = await repository.replaceMessagesForUrl(
      'https://example.com/article',
      [],
    );

    expect(updated).toHaveLength(2);
    await expect(
      repository.get(4, 'https://example.com/article'),
    ).resolves.toMatchObject({ messages: [] });
    await expect(
      repository.get(6, 'https://example.com/other'),
    ).resolves.toMatchObject({ messages: [{ content: 'Question' }] });
  });

  it('clears messages from every active context without deleting articles', async () => {
    const storage = new MemoryStorage();
    const repository = new SessionContextRepository(storage);
    await repository.save(createContext(4, 'https://example.com/article'));
    await repository.save(createContext(5, 'https://example.com/other'));

    const updated = await repository.clearAllMessages();

    expect(updated).toHaveLength(2);
    expect(updated.every((context) => context.messages.length === 0)).toBe(true);
    expect(updated.every((context) => context.article !== null)).toBe(true);
  });

  it('serializes context updates so concurrent field changes are preserved', async () => {
    const storage = new MemoryStorage();
    const repository = new SessionContextRepository(storage);
    const context = createContext(4, 'https://example.com/article');
    await repository.save(context);

    await Promise.all([
      repository.update(4, context.url, (current) => ({
        ...current,
        focus: {
          type: 'text',
          text: 'Selected text',
          section: 'Article',
        },
      })),
      repository.update(4, context.url, (current) => ({
        ...current,
        warning: 'Updated warning',
      })),
    ]);

    await expect(repository.get(4, context.url)).resolves.toMatchObject({
      focus: {
        type: 'text',
        text: 'Selected text',
      },
      warning: 'Updated warning',
    });
  });
});

describe('ConversationArchive', () => {
  it('persists messages without article, focus, or image data', async () => {
    const storage = new MemoryStorage();
    const archive = new ConversationArchive(storage);
    const context: PageContext = {
      ...createContext(4, 'https://example.com/article'),
      messages: [
        {
          id: 'message',
          role: 'user',
          content: 'Question',
          createdAt: 1,
          reference: {
            type: 'region',
            imageUrl: 'data:image/jpeg;base64,private-screenshot',
            text: 'Selected chart',
            section: 'Results',
            source: 'screenshot',
          },
        },
        {
          id: 'answer',
          role: 'assistant',
          content: 'Answer',
          createdAt: 2,
          answeredBy: 'deepseek',
        },
      ],
    };

    await archive.save(context);

    expect(JSON.stringify(storage.values)).toContain('Question');
    expect(JSON.stringify(storage.values)).toContain('Selected chart');
    expect(JSON.stringify(storage.values)).not.toContain('"article"');
    expect(JSON.stringify(storage.values)).not.toContain('"focus"');
    expect(JSON.stringify(storage.values)).not.toContain('private-screenshot');
    await expect(archive.load(context.url)).resolves.toEqual([
      {
        ...context.messages[0],
        reference: {
          type: 'region',
          text: 'Selected chart',
          section: 'Results',
          source: 'screenshot',
        },
      },
      context.messages[1],
    ]);
  });

  it('merges completed messages saved from separate contexts for the same URL', async () => {
    const storage = new MemoryStorage();
    const archive = new ConversationArchive(storage);
    const url = 'https://example.com/article';
    const first = createContext(4, url);
    first.messages = [
      {
        id: 'question-1',
        role: 'user',
        content: 'First question',
        createdAt: 1,
      },
      {
        id: 'answer-1',
        role: 'assistant',
        content: 'First answer',
        createdAt: 2,
      },
    ];
    const second = createContext(5, url);
    second.messages = [
      {
        id: 'question-2',
        role: 'user',
        content: 'Second question',
        createdAt: 3,
      },
      {
        id: 'answer-2',
        role: 'assistant',
        content: 'Second answer',
        createdAt: 4,
      },
    ];

    await Promise.all([archive.save(first), archive.save(second)]);

    await expect(archive.load(url)).resolves.toEqual([
      ...first.messages,
      ...second.messages,
    ]);
  });

  it('can clear every retained conversation', async () => {
    const storage = new MemoryStorage();
    const archive = new ConversationArchive(storage);
    const context = createContext(4, 'https://example.com/article');
    context.messages.push({
      id: 'answer',
      role: 'assistant',
      content: 'Answer',
      createdAt: 2,
    });
    await archive.save(context);

    await archive.clear();

    expect(storage.values).toEqual({});
  });

  it('returns an empty history for malformed archives and supports deletion', async () => {
    const storage = new MemoryStorage();
    const archive = new ConversationArchive(storage);
    const url = 'https://example.com/article';
    storage.values[`context-reader:conversation:${url}`] = {
      normalizedUrl: url,
    };

    await expect(archive.load(url)).resolves.toEqual([]);
    await archive.delete(url);
    expect(storage.values).toEqual({});
    await archive.clear();
    expect(storage.values).toEqual({});
  });

  it('lists V1 records by recency and searches their full text', async () => {
    const storage = new MemoryStorage();
    const archive = new ConversationArchive(storage);
    storage.values['context-reader:conversation:https://example.com/older'] = {
      normalizedUrl: 'https://example.com/older',
      title: 'Older article',
      messages: [
        {
          id: 'older-question',
          role: 'user',
          content: 'How are checkpoints written?',
          createdAt: 1,
        },
        {
          id: 'older-answer',
          role: 'assistant',
          content: 'They are persisted after each turn.',
          createdAt: 2,
        },
      ],
      updatedAt: 2,
    };
    storage.values['context-reader:conversation:https://example.com/newer'] = {
      normalizedUrl: 'https://example.com/newer',
      title: 'Newer article',
      messages: [
        {
          id: 'newer-question',
          role: 'user',
          content: 'What is retrieval?',
          createdAt: 3,
        },
        {
          id: 'newer-answer',
          role: 'assistant',
          content: 'It selects relevant history.',
          createdAt: 4,
        },
      ],
      updatedAt: 4,
    };

    await expect(archive.list()).resolves.toMatchObject([
      {
        title: 'Newer article',
        questionCount: 1,
        lastQuestion: 'What is retrieval?',
      },
      {
        title: 'Older article',
        createdAt: 1,
        questionCount: 1,
      },
    ]);
    await expect(archive.list('persisted')).resolves.toMatchObject([
      { title: 'Older article' },
    ]);
  });

  it('reports local storage usage and drops unanswered messages', async () => {
    const storage = new MemoryStorage();
    const archive = new ConversationArchive(storage);
    await archive.save(createContext(4, 'https://example.com/article'));

    await expect(archive.load('https://example.com/article')).resolves.toEqual(
      [],
    );
    await expect(archive.usage()).resolves.toMatchObject({
      bytesInUse: expect.any(Number),
      quotaBytes: 10 * 1024 * 1024,
    });
  });

  it('normalizes legacy records with missing metadata', async () => {
    const storage = new MemoryStorage();
    const archive = new ConversationArchive(storage);
    storage.values['context-reader:conversation:https://example.com/legacy'] = {
      normalizedUrl: 'https://example.com/legacy/',
      title: '',
      messages: [
        {
          id: 'legacy-question',
          role: 'user',
          content: 'Legacy question',
          createdAt: 10,
        },
        {
          id: 'legacy-answer',
          role: 'assistant',
          content: 'Legacy answer',
          createdAt: 11,
        },
      ],
    };

    await expect(archive.get('https://example.com/legacy/')).resolves.toEqual({
      schemaVersion: 2,
      normalizedUrl: 'https://example.com/legacy',
      title: 'example.com',
      messages: expect.any(Array),
      createdAt: 10,
      updatedAt: 11,
    });
  });

  it('estimates usage when the storage adapter lacks byte accounting', async () => {
    const storage = new MemoryStorage();
    const archive = new ConversationArchive({
      get: (keys) => storage.get(keys),
      set: (items) => storage.set(items),
      remove: (keys) => storage.remove(keys),
    });
    const context = createContext(4, 'https://example.com/article');
    context.messages.push({
      id: 'answer',
      role: 'assistant',
      content: 'Answer',
      createdAt: 2,
    });
    await archive.save(context);

    const usage = await archive.usage();

    expect(usage.bytesInUse).toBeGreaterThan(0);
    expect(usage.quotaBytes).toBe(10 * 1024 * 1024);
  });
});
