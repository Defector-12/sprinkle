import { describe, expect, it } from 'vitest';

import { ContextRegistry } from '../../src/core/context-registry.ts';
import type { ArticleDocument, ChatMessage } from '../../src/core/types.ts';

const article: ArticleDocument = {
  title: 'Context-aware reading',
  url: 'https://example.com/article',
  blocks: [
    {
      id: 'block-1',
      type: 'paragraph',
      text: 'The current article is available to the assistant.',
      section: 'Overview',
      order: 0,
    },
  ],
  images: [],
  isPartial: false,
};

const message: ChatMessage = {
  id: 'message-1',
  role: 'user',
  content: 'What does context mean here?',
  createdAt: 1,
};

describe('ContextRegistry', () => {
  it('creates new pages as unactivated', () => {
    const registry = new ContextRegistry();

    const context = registry.getOrCreate(
      3,
      'https://example.com/article',
      'Article',
    );

    expect(context.status).toBe('unactivated');
    expect(context.article).toBeNull();
  });

  it('restores the same context when returning to a page', () => {
    const registry = new ContextRegistry();
    registry.setArticle(3, article);
    registry.appendMessage(3, article.url, message);
    registry.getOrCreate(3, 'https://example.com/other', 'Other');

    const restored = registry.getOrCreate(3, article.url, article.title);

    expect(restored.status).toBe('ready');
    expect(restored.messages).toEqual([message]);
  });

  it('isolates contexts by tab and URL', () => {
    const registry = new ContextRegistry();
    registry.setArticle(3, article);

    const otherTab = registry.getOrCreate(4, article.url, article.title);
    const otherPage = registry.getOrCreate(
      3,
      'https://example.com/other',
      'Other',
    );

    expect(otherTab.status).toBe('unactivated');
    expect(otherPage.status).toBe('unactivated');
  });

  it('disposes every temporary context for a closed tab only', () => {
    const registry = new ContextRegistry();
    registry.setArticle(3, article);
    registry.getOrCreate(3, 'https://example.com/other', 'Other');
    registry.getOrCreate(4, article.url, article.title);

    registry.disposeTab(3);

    expect(registry.listForTab(3)).toEqual([]);
    expect(registry.listForTab(4)).toHaveLength(1);
  });
});
