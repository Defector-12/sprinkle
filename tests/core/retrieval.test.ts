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

  it('uses BM25 to prioritize distinctive terms over repeated generic words', () => {
    const chunks: ArticleChunk[] = [
      {
        id: 'generic',
        section: 'Background',
        text: 'The model uses a model component for model processing.',
        blockIds: ['generic'],
      },
      {
        id: 'fusion',
        section: 'Retrieval',
        text: 'Reciprocal rank fusion combines independently ranked result lists.',
        blockIds: ['fusion'],
      },
    ];

    const results = retrieveRelevantChunks(chunks, {
      question: 'How does reciprocal rank fusion combine results?',
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.text).toContain('Reciprocal rank fusion');
  });

  it('returns the matching child with neighboring context from the same section', () => {
    const chunks: ArticleChunk[] = [
      {
        id: 'method-setup',
        section: 'Method > Calibration',
        text: 'The calibration set contains held-out predictions.',
        blockIds: ['method-setup'],
      },
      {
        id: 'method-threshold',
        section: 'Method > Calibration',
        text: 'A conformal threshold controls the target error rate.',
        blockIds: ['method-threshold'],
      },
      {
        id: 'method-result',
        section: 'Method > Calibration',
        text: 'Coverage is then measured on the evaluation split.',
        blockIds: ['method-result'],
      },
      {
        id: 'limitations',
        section: 'Limitations',
        text: 'The method assumes exchangeable samples.',
        blockIds: ['limitations'],
      },
    ];

    const results = retrieveRelevantChunks(chunks, {
      question: 'How does the conformal threshold control error?',
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.text).toContain('calibration set');
    expect(results[0]?.text).toContain('conformal threshold');
    expect(results[0]?.text).toContain('Coverage is then measured');
    expect(results[0]?.text).not.toContain('exchangeable samples');
  });

  it('stops adding evidence windows when the relevant-context budget is full', () => {
    const chunks: ArticleChunk[] = [
      {
        id: 'alpha',
        section: 'Alpha',
        text: `evidence alpha ${'a'.repeat(170)}`,
        blockIds: ['alpha'],
      },
      {
        id: 'beta',
        section: 'Beta',
        text: `evidence beta ${'b'.repeat(170)}`,
        blockIds: ['beta'],
      },
      {
        id: 'gamma',
        section: 'Gamma',
        text: `evidence gamma ${'c'.repeat(170)}`,
        blockIds: ['gamma'],
      },
    ];

    const results = retrieveRelevantChunks(chunks, {
      question: 'evidence alpha beta gamma',
      limit: 3,
      characterBudget: 400,
    });
    const selectedLength = results.reduce(
      (total, chunk) => total + chunk.section.length + chunk.text.length + 3,
      0,
    );

    expect(results).toHaveLength(2);
    expect(selectedLength).toBeLessThanOrEqual(400);
  });

  it('returns no evidence when no meaningful query term matches', () => {
    const chunks = createArticleChunks(blocks, 180);

    expect(
      retrieveRelevantChunks(chunks, {
        question: 'How are mitochondrial ribosomes assembled?',
        limit: 6,
      }),
    ).toEqual([]);
  });

  it('fuses multiple query rankings to cover evidence from different sections', () => {
    const chunks: ArticleChunk[] = [
      {
        id: 'latency',
        section: 'Results > Latency',
        text: 'Speculative decoding reduces inference latency by 35 percent.',
        blockIds: ['latency'],
      },
      {
        id: 'accuracy',
        section: 'Results > Accuracy',
        text: 'Constrained decoding improves exact-match accuracy by 8 points.',
        blockIds: ['accuracy'],
      },
      {
        id: 'background',
        section: 'Background',
        text: 'Language models generate tokens autoregressively.',
        blockIds: ['background'],
      },
    ];

    const selection = selectArticleContext(chunks, {
      question: 'Compare the two reported improvements.',
      searchQueries: [
        'speculative decoding inference latency',
        'constrained decoding exact match accuracy',
      ],
    });

    expect(selection.chunks.map((chunk) => chunk.section)).toEqual([
      'Results > Latency',
      'Results > Accuracy',
    ]);
  });

  it('keeps a focused question near its document anchor instead of recalling similarly named sections', () => {
    const chunks: ArticleChunk[] = [
      {
        id: 'build-governance',
        section: 'Build > CLAUDE.md > Governance considerations',
        text: 'CLAUDE.md is version controlled and code owners approve changes.',
        blockIds: ['build-governance'],
      },
      {
        id: 'skills-governance',
        section: 'Build > Skills > Governance considerations',
        text: 'Skills are advisory controls backed by deterministic hooks.',
        blockIds: ['skills-governance'],
      },
      {
        id: 'test-execution',
        section: 'Test > Give Claude a feedback loop > How to execute it',
        text: 'Require build, test, and lint evidence before completion.',
        blockIds: ['test-execution'],
      },
      {
        id: 'test-verification',
        section:
          'Test > Give Claude a feedback loop > What it looks like (CLAUDE.md verification block)',
        text: [
          'What it looks like (CLAUDE.md verification block)',
          'Verification before a task is reported done, and block edits to test files during a fix.',
        ].join('\n'),
        blockIds: ['test-verification'],
      },
      {
        id: 'test-measurement',
        section: 'Test > Give Claude a feedback loop > How to measure it',
        text: 'Measure first-pass CI success rate and review time per PR.',
        blockIds: ['test-measurement'],
      },
      {
        id: 'deploy-governance',
        section: 'Deploy > Governance considerations',
        text: 'Deployment approvals are recorded in the release workflow.',
        blockIds: ['deploy-governance'],
      },
    ];

    const results = retrieveRelevantChunks(chunks, {
      question: '我问的是这一部分',
      focusText: 'Governance considerations',
      focusSection:
        'Test > Give Claude a feedback loop > What it looks like (CLAUDE.md verification block)',
      limit: 6,
    });

    expect(results.map((chunk) => chunk.id)).toEqual([
      'test-verification',
      'test-measurement',
      'test-execution',
    ]);
    expect(results.map((chunk) => chunk.id)).not.toContain(
      'build-governance',
    );
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
