import { describe, expect, it } from 'vitest';

import {
  articleContentBlocks,
  createArticleChunks,
  isWholeArticleQuestion,
  retrieveRelevantChunks,
  selectArticleContext,
  WHOLE_ARTICLE_CHARACTER_BUDGET,
} from '../../src/core/retrieval.ts';
import type {
  ArticleBlock,
  ArticleChunk,
} from '../../src/core/types.ts';

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

  it('adds parsed tables, formulas, and image descriptions to model content', () => {
    const contentBlocks = articleContentBlocks({
      title: 'Benchmark',
      url: 'https://example.com/benchmark',
      blocks: [blocks[0] as ArticleBlock],
      images: [
        {
          id: 'image-1',
          src: 'https://example.com/chart.png',
          alt: 'Accuracy chart',
          caption: 'Model A leads',
          section: 'Results',
          surroundingText: '',
          order: 1,
        },
      ],
      tables: [
        {
          id: 'table-1',
          caption: 'Accuracy',
          section: 'Results',
          order: 1,
          rows: [
            {
              cells: [
                { text: 'Model', header: true, colSpan: 1, rowSpan: 1 },
                { text: 'Score', header: true, colSpan: 1, rowSpan: 1 },
              ],
            },
            {
              cells: [
                { text: 'A', header: false, colSpan: 1, rowSpan: 1 },
                { text: '92', header: false, colSpan: 1, rowSpan: 1 },
              ],
            },
          ],
        },
      ],
      formulas: [
        {
          id: 'formula-1',
          tex: 'a^2 + b^2 = c^2',
          mathml: '<math></math>',
          section: 'Results',
          order: 1,
          display: 'block',
        },
      ],
      isPartial: false,
    });
    const text = contentBlocks.map((block) => block.text).join('\n');

    expect(text).toContain('表格：Accuracy');
    expect(text).toContain('Model | Score');
    expect(text).toContain('公式：a^2 + b^2 = c^2');
    expect(text).toContain('图片说明：Accuracy chart；Model A leads');
  });

  it('splits a single oversized block to respect the chunk limit', () => {
    const chunks = createArticleChunks(
      [
        {
          id: 'large',
          type: 'paragraph',
          text: 'x'.repeat(450),
          section: 'Large section',
          order: 0,
        },
      ],
      180,
    );

    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.text.length <= 180)).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join('')).toHaveLength(450);
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

  it('recognizes Chinese and English whole-article questions', () => {
    expect(isWholeArticleQuestion('请总结全部内容')).toBe(true);
    expect(isWholeArticleQuestion('梳理一下这篇文章的整体结构')).toBe(true);
    expect(isWholeArticleQuestion('概括文章内容')).toBe(true);
    expect(
      isWholeArticleQuestion(
        '组织一下这篇文档的观点，每个观点都简单解释即可',
      ),
    ).toBe(true);
    expect(isWholeArticleQuestion('Summarize the entire article.')).toBe(true);
    expect(isWholeArticleQuestion('Summarize everything on this page.')).toBe(
      true,
    );
    expect(isWholeArticleQuestion('总结这个段落')).toBe(false);
  });

  it('uses every chunk in document order for a whole-article question', () => {
    const chunks = createArticleChunks(blocks, 80);
    const selection = selectArticleContext(chunks, {
      question: '请总结全文',
      limit: 1,
    });

    expect(selection.mode).toBe('whole');
    expect(selection.isTruncated).toBe(false);
    expect(selection.chunks).toEqual(chunks);
  });

  it('covers the beginning, middle, and end when a whole article exceeds the request budget', () => {
    const chunks: ArticleChunk[] = Array.from(
      { length: 60 },
      (_, index) => ({
        id: `chunk-${index + 1}`,
        section: `Section ${index + 1}`,
        text: String(index + 1).padEnd(1_800, 'x'),
        blockIds: [`block-${index + 1}`],
      }),
    );

    const selection = selectArticleContext(chunks, {
      question: 'Give me an overview of the whole document',
    });
    const selectedIndexes = selection.chunks.map((chunk) =>
      chunks.indexOf(chunk),
    );
    const selectedLength = selection.chunks.reduce(
      (total, chunk) =>
        total + chunk.section.length + chunk.text.length + 3,
      0,
    );

    expect(selection.mode).toBe('whole');
    expect(selection.isTruncated).toBe(true);
    expect(selection.chunks.length).toBeLessThan(chunks.length);
    expect(selectedIndexes[0]).toBe(0);
    expect(selectedIndexes.at(-1)).toBe(chunks.length - 1);
    expect(
      selectedIndexes.some(
        (index) => index > chunks.length / 3 && index < chunks.length * 2 / 3,
      ),
    ).toBe(true);
    expect(selectedLength).toBeLessThanOrEqual(
      WHOLE_ARTICLE_CHARACTER_BUDGET,
    );
  });
});
