import { describe, expect, it } from 'vitest';

import { createPageKey, normalizePageUrl } from '../../src/core/url.ts';

describe('normalizePageUrl', () => {
  it('removes fragments, tracking parameters, and a trailing slash', () => {
    expect(
      normalizePageUrl(
        'https://example.com/posts/rag/?utm_source=newsletter&lang=zh#architecture',
      ),
    ).toBe('https://example.com/posts/rag?lang=zh');
  });

  it('keeps meaningful query parameters and sorts them for stable identity', () => {
    expect(
      normalizePageUrl('https://example.com/doc?version=2&section=agent'),
    ).toBe('https://example.com/doc?section=agent&version=2');
  });

  it('keeps the root path intact', () => {
    expect(normalizePageUrl('https://example.com/')).toBe(
      'https://example.com/',
    );
  });

  it('preserves hash routes while removing ordinary heading anchors', () => {
    expect(normalizePageUrl('https://example.com/app#/docs/a')).toBe(
      'https://example.com/app#/docs/a',
    );
    expect(normalizePageUrl('https://example.com/app#/docs/b')).not.toBe(
      normalizePageUrl('https://example.com/app#/docs/a'),
    );
    expect(normalizePageUrl('https://example.com/post#heading')).toBe(
      'https://example.com/post',
    );
  });
});

describe('createPageKey', () => {
  it('isolates the same URL in different tabs', () => {
    expect(createPageKey(7, 'https://example.com/post')).not.toBe(
      createPageKey(8, 'https://example.com/post'),
    );
  });

  it('treats anchor navigation as the same page context', () => {
    expect(createPageKey(7, 'https://example.com/post#one')).toBe(
      createPageKey(7, 'https://example.com/post#two'),
    );
  });
});
