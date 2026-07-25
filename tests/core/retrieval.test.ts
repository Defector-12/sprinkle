import { describe, expect, it } from 'vitest';

import {
  createArticleChunks,
  retrieveRelevantChunks,
} from '../../src/core/retrieval.ts';
import type { ArticleBlock } from '../../src/core/types.ts';

const blocks: ArticleBlock[] = [
  {
    id: 'intro',
    type: 'heading',
    text: 'Introduction',
    section: 'Introduction',
    order: 0,
  },
  {
    id: 'intro-body',
    type: 'paragraph',
    text: 'This article explains a browser reading assistant.',
    section: 'Introduction',
    order: 1,
  },
  {
    id: 'retrieval',
    type: 'heading',
    text: 'Vector retrieval',
    section: 'Vector retrieval',
    order: 2,
  },
  {
    id: 'retrieval-body',
    type: 'paragraph',
    text: 'A vector database retrieves semantically related article chunks.',
    section: 'Vector retrieval',
    order: 3,
  },
  {
    id: 'privacy',
    type: 'heading',
    text: 'Privacy',
    section: 'Privacy',
    order: 4,
  },
  {
    id: 'privacy-body',
    type: 'paragraph',
    text: 'Temporary page content is deleted when the tab closes.',
    section: 'Privacy',
    order: 5,
  },
];

describe('article retrieval', () => {
  it('groups blocks into section-aware chunks', () => {
    const chunks = createArticleChunks(blocks, 180);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]).toEqual(
      expect.objectContaining({
        section: 'Vector retrieval',
      }),
    );
  });

  it('ranks chunks related to the question and focused text first', () => {
    const chunks = createArticleChunks(blocks, 180);

    const results = retrieveRelevantChunks(chunks, {
      question: 'Why does it use a vector database?',
      focusText: 'semantically related article chunks',
      limit: 2,
    });

    expect(results[0]?.section).toBe('Vector retrieval');
    expect(results[0]?.text).toContain('vector database');
  });

  it('supports Chinese terms without requiring whitespace tokenization', () => {
    const chineseBlocks: ArticleBlock[] = [
      {
        id: 'cn-1',
        type: 'paragraph',
        text: '向量数据库用于召回与问题语义相关的文章片段。',
        section: '检索',
        order: 0,
      },
      {
        id: 'cn-2',
        type: 'paragraph',
        text: '浏览器关闭后会清理临时上下文。',
        section: '隐私',
        order: 1,
      },
    ];

    const results = retrieveRelevantChunks(
      createArticleChunks(chineseBlocks, 120),
      {
        question: '向量检索是怎么工作的？',
        limit: 1,
      },
    );

    expect(results[0]?.section).toBe('检索');
  });
});
