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
    ]);
  });

  it('can clear every retained conversation', async () => {
    const storage = new MemoryStorage();
    const archive = new ConversationArchive(storage);
    await archive.save(createContext(4, 'https://example.com/article'));

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
});
