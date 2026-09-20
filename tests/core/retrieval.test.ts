import { describe, expect, it } from 'vitest';

import {
  articleContentBlocks,
  createArticleChunks,
  isWholeArticleQuestion,
  RETRIEVAL_CHUNK_HARD_MAXIMUM,
  retrieveExactMatchChunks,
  retrieveRelevantChunks,
  selectArticleContext,
  selectDocumentCoverage,
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

  it('splits oversized Chinese prose at complete sentence boundaries', () => {
    const sentences = [
      `第一句${'甲'.repeat(500)}。`,
      `第二句${'乙'.repeat(500)}。`,
      `第三句${'丙'.repeat(500)}。`,
    ];
    const chunks = createArticleChunks([
      {
        id: 'chinese-prose',
        type: 'paragraph',
        text: sentences.join(''),
        section: '正文',
        order: 0,
      },
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toBe(sentences.slice(0, 2).join(''));
    expect(chunks[1]?.text).toBe(sentences[2]);
    expect(chunks.every((item) =>
      item.text.length <= RETRIEVAL_CHUNK_HARD_MAXIMUM
    )).toBe(true);
  });

  it('keeps complete English sentences when sentence segmentation is available', () => {
    const sentences = [
      `Alpha ${'word '.repeat(96).trim()}. `,
      `Beta ${'term '.repeat(96).trim()}. `,
      `Gamma ${'token '.repeat(80).trim()}.`,
    ];
    const chunks = createArticleChunks([
      {
        id: 'english-prose',
        type: 'paragraph',
        text: sentences.join(''),
        section: 'Body',
        order: 0,
      },
    ]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((item) => item.text).join('')).toBe(sentences.join(''));
    expect(
      chunks.every((item) => /[.]\s*$/u.test(item.text)),
    ).toBe(true);
  });

  it('falls back safely when one sentence exceeds the hard maximum', () => {
    const text = `超长句${'字'.repeat(1_500)}。`;
    const chunks = createArticleChunks([
      {
        id: 'oversized-sentence',
        type: 'paragraph',
        text,
        section: '正文',
        order: 0,
      },
    ]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((item) =>
      item.text.length <= RETRIEVAL_CHUNK_HARD_MAXIMUM
    )).toBe(true);
    expect(chunks.map((item) => item.text).join('')).toBe(text);
  });

  it('splits code at line boundaries and retains indentation and newlines', () => {
    const lines = [
      `function first() { ${'a'.repeat(430)} }\n`,
      `  const second = "${'b'.repeat(430)}";\n`,
      `return "${'c'.repeat(430)}";`,
    ];
    const chunks = createArticleChunks([
      {
        id: 'long-code',
        type: 'code',
        text: lines.join(''),
        section: 'Implementation',
        order: 0,
      },
    ]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((item) => item.text).join('')).toBe(lines.join(''));
    expect(chunks.some((item) => item.text.startsWith('  const second'))).toBe(
      false,
    );
    expect(chunks.some((item) => item.text.includes('  const second'))).toBe(
      true,
    );
  });

  it('splits lists between complete items', () => {
    const items = [
      `第一项 ${'甲'.repeat(430)}`,
      `第二项 ${'乙'.repeat(430)}`,
      `第三项 ${'丙'.repeat(430)}`,
    ];
    const chunks = createArticleChunks([
      {
        id: 'long-list',
        type: 'list',
        text: items.join('\n'),
        section: '清单',
        order: 0,
      },
    ]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((item) => item.text).join('')).toBe(items.join('\n'));
    for (const item of items) {
      expect(chunks.filter((chunk) => chunk.text.includes(item))).toHaveLength(
        1,
      );
    }
  });

  it('repeats table labels and headers without dropping source rows', () => {
    const label = '表格：性能';
    const header = '模型 | 分数';
    const rows = Array.from(
      { length: 6 },
      (_, index) => `模型 ${index + 1} | ${String(index).repeat(260)}`,
    );
    const chunks = createArticleChunks([
      {
        id: 'context-table-1',
        type: 'paragraph',
        text: [label, header, ...rows].join('\n'),
        section: '结果',
        order: 0,
      },
    ]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every((item) => item.text.startsWith(`${label}\n${header}\n`)),
    ).toBe(true);
    const emittedRows = chunks.flatMap((item) => item.text.split('\n').slice(2));
    expect(emittedRows).toEqual(rows);
    expect(new Set(chunks.flatMap((item) => item.blockIds)).size).toBe(
      chunks.length,
    );
  });

  it('never packs blocks from different sections into one chunk', () => {
    const chunks = createArticleChunks([
      {
        id: 'section-a',
        type: 'paragraph',
        text: 'A'.repeat(300),
        section: 'Section A',
        order: 0,
      },
      {
        id: 'section-b',
        type: 'paragraph',
        text: 'B'.repeat(300),
        section: 'Section B',
        order: 1,
      },
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks.map((item) => item.section)).toEqual([
      'Section A',
      'Section B',
    ]);
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

  it('uses literal matching to prioritize an exact API identifier', () => {
    const chunks: ArticleChunk[] = [
      {
        id: 'generic',
        section: 'Agent events',
        text: 'The agent emits general lifecycle events during execution.',
        blockIds: ['generic'],
      },
      {
        id: 'identifier',
        section: 'API reference',
        text: 'Call session.subscribe() to receive AgentSessionEvent values.',
        blockIds: ['identifier'],
      },
    ];

    const results = retrieveExactMatchChunks(chunks, {
      question: 'What does `session.subscribe()` return?',
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.text).toContain('session.subscribe()');
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

  it('includes descendant sections when the selected text is a section heading', () => {
    const chunks: ArticleChunk[] = [
      {
        id: 'progressive-disclosure',
        section: 'Understanding Progressive Disclosure',
        text: 'Context injection uses progressive disclosure for efficient token usage.',
        blockIds: ['progressive-disclosure'],
      },
      {
        id: 'layer-1',
        section:
          'Understanding Progressive Disclosure > Layer 1: Index Display (Session Start)',
        text: 'Shows observation titles with token cost estimates.',
        blockIds: ['layer-1'],
      },
      {
        id: 'layer-2',
        section:
          'Understanding Progressive Disclosure > Layer 2: On-Demand Details (MCP Tools)',
        text: 'Searches, opens the timeline, and fetches full observations.',
        blockIds: ['layer-2'],
      },
      {
        id: 'layer-3',
        section:
          'Understanding Progressive Disclosure > Layer 3: Perfect Recall (Code Access)',
        text: 'Reads source files, transcripts, and raw data when needed.',
        blockIds: ['layer-3'],
      },
      {
        id: 'next-section',
        section: 'Multi-Prompt Sessions',
        text: 'Sessions can span multiple prompts.',
        blockIds: ['next-section'],
      },
    ];

    const results = retrieveRelevantChunks(chunks, {
      question: '解释一下这部分的三层分别都是什么',
      focusText: 'Understanding Progressive Disclosure',
      focusSection: 'Understanding Progressive Disclosure',
      focusScope: 'section',
      focusHeadingLevel: 2,
    });

    expect(results.map((chunk) => chunk.id)).toEqual([
      'progressive-disclosure',
      'layer-1',
      'layer-2',
      'layer-3',
    ]);
    expect(results.map((chunk) => chunk.id)).not.toContain('next-section');
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

  it('keeps more than eight chunks when the complete article fits the whole budget', () => {
    const chunks = Array.from({ length: 12 }, (_, index) => ({
      id: `small-${index}`,
      section: `Section ${index}`,
      text: `Content ${index}`,
      blockIds: [`block-${index}`],
    }));
    const selection = selectArticleContext(chunks, {
      question: '请总结全文',
    });

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

  it('represents every major section when coverage slots and budget allow', () => {
    const chunks: ArticleChunk[] = [
      {
        id: 'a-1',
        section: 'A > Intro',
        text: 'A intro',
        blockIds: ['a-1'],
      },
      {
        id: 'a-2',
        section: 'A > Detail',
        text: 'A detail',
        blockIds: ['a-2'],
      },
      {
        id: 'b-1',
        section: 'B > Intro',
        text: 'B intro',
        blockIds: ['b-1'],
      },
      {
        id: 'c-1',
        section: 'C > Intro',
        text: 'C intro',
        blockIds: ['c-1'],
      },
    ];

    expect(
      selectDocumentCoverage(chunks, 10_000, 3).map((item) => item.id),
    ).toEqual(['a-1', 'b-1', 'c-1']);
  });

  it('keeps first and last sections when groups exceed coverage slots', () => {
    const chunks = Array.from({ length: 12 }, (_, index) => ({
      id: `section-${index}`,
      section: `Section ${index}`,
      text: `Content ${index}`,
      blockIds: [`block-${index}`],
    }));
    const selected = selectDocumentCoverage(chunks, 10_000, 5);

    expect(selected).toHaveLength(5);
    expect(selected[0]?.id).toBe('section-0');
    expect(selected.at(-1)?.id).toBe('section-11');
  });

  it('gives long sections extra tail and middle coverage in article order', () => {
    const chunks: ArticleChunk[] = [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `long-${index}`,
        section: `Document > Long > Part ${index}`,
        text: `Long ${index} ${'x'.repeat(80)}`,
        blockIds: [`long-${index}`],
      })),
      {
        id: 'short',
        section: 'Document > Short',
        text: 'Short',
        blockIds: ['short'],
      },
    ];
    const selected = selectDocumentCoverage(chunks, 10_000, 4);
    const ids = selected.map((item) => item.id);

    expect(ids).toEqual([...ids].toSorted());
    expect(ids).toContain('long-0');
    expect(ids).toContain('long-5');
    expect(ids).toContain('short');
  });

  it('keeps section coverage within the character and window budgets', () => {
    const chunks = Array.from({ length: 20 }, (_, index) => ({
      id: `budget-${index}`,
      section: `Section ${index}`,
      text: `${index} ${'x'.repeat(180)}`,
      blockIds: [`budget-${index}`],
    }));
    const selected = selectDocumentCoverage(chunks, 1_000);
    const length = selected.reduce(
      (total, item) => total + item.section.length + item.text.length + 3,
      0,
    );

    expect(selected.length).toBeLessThanOrEqual(8);
    expect(length).toBeLessThanOrEqual(1_000);
  });

  it('handles flat documents deterministically', () => {
    const chunks = Array.from({ length: 5 }, (_, index) => ({
      id: `flat-${index}`,
      section: 'Article',
      text: `Paragraph ${index} ${'x'.repeat(80)}`,
      blockIds: [`flat-${index}`],
    }));

    expect(selectDocumentCoverage(chunks, 10_000, 3).map((item) => item.id))
      .toEqual(['flat-0', 'flat-2', 'flat-4']);
  });
});
