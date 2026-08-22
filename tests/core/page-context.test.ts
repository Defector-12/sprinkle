import { describe, expect, it } from 'vitest';

import { createPageContext } from '../../src/core/page-context.ts';

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
});
