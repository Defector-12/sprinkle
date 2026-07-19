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
});

describe('ConversationArchive', () => {
  it('persists messages without article, focus, or image data', async () => {
    const storage = new MemoryStorage();
    const archive = new ConversationArchive(storage);
    const context = createContext(4, 'https://example.com/article');

    await archive.save(context);

    expect(JSON.stringify(storage.values)).toContain('Question');
    expect(JSON.stringify(storage.values)).not.toContain('"article"');
    expect(JSON.stringify(storage.values)).not.toContain('"focus"');
    await expect(archive.load(context.url)).resolves.toEqual(context.messages);
  });

  it('can clear every retained conversation', async () => {
    const storage = new MemoryStorage();
    const archive = new ConversationArchive(storage);
    await archive.save(createContext(4, 'https://example.com/article'));

    await archive.clear();

    expect(storage.values).toEqual({});
  });
});
