import { describe, expect, it } from 'vitest';

import {
  canAskPage,
  createPageContext,
} from '../../src/core/page-context.ts';

describe('createPageContext', () => {
  it('creates a dormant context with normalized page identity', () => {
    const context = createPageContext(
      7,
      'https://example.com/article/?utm_source=test#section',
      'Article',
    );

    expect(context).toEqual(
      expect.objectContaining({
        key: '7:https://example.com/article',
        normalizedUrl: 'https://example.com/article',
        title: 'Article',
        status: 'unactivated',
        article: null,
        focus: null,
        messages: [],
      }),
    );
  });

  it('allows questions only for ready or partial contexts with an article', () => {
    const context = createPageContext(
      7,
      'https://example.com/article',
      'Article',
    );
    const article = {
      title: context.title,
      url: context.url,
      blocks: [],
      images: [],
      isPartial: false,
    };

    expect(canAskPage(null)).toBe(false);
    expect(canAskPage(context)).toBe(false);
    expect(canAskPage({ ...context, status: 'answering', article })).toBe(false);
    expect(canAskPage({ ...context, status: 'ready', article })).toBe(true);
    expect(
      canAskPage({
        ...context,
        status: 'partial',
        article: { ...article, isPartial: true },
      }),
    ).toBe(true);
  });
});
