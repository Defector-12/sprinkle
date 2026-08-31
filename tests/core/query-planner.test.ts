import { describe, expect, it, vi } from 'vitest';

import {
  buildQueryPlanRequest,
  parseQueryPlan,
  planRetrievalQueries,
  shouldPlanRetrieval,
} from '../../src/core/query-planner.ts';
import type {
  ArticleDocument,
  ChatMessage,
  ModelRequest,
} from '../../src/core/types.ts';

const article: ArticleDocument = {
  title: 'Calibrated Retrieval',
  url: 'https://example.com/paper',
  blocks: [
    {
      id: 'abstract-heading',
      type: 'heading',
      text: 'Abstract',
      section: 'Abstract',
      order: 0,
    },
    {
      id: 'abstract-body',
      type: 'paragraph',
      text: 'The paper studies calibration and retrieval quality.',
      section: 'Abstract',
      order: 1,
    },
    {
      id: 'method',
      type: 'heading',
      text: 'Method',
      section: 'Method',
      order: 2,
    },
    {
      id: 'private-body',
      type: 'paragraph',
      text: 'This implementation detail must not be sent to the planner.',
      section: 'Method',
      order: 3,
    },
    {
      id: 'results',
      type: 'heading',
      text: 'Results',
      section: 'Results',
      order: 4,
    },
  ],
  images: [],
  isPartial: false,
};

const history: ChatMessage[] = [
  {
    id: 'question-1',
    role: 'user',
    content: 'What calibration method does the paper propose?',
    createdAt: 1,
  },
  {
    id: 'answer-1',
    role: 'assistant',
    content: 'It proposes conformal calibration.',
    createdAt: 2,
  },
];

describe('query planner', () => {
  it('plans low-recall, follow-up, and comparison questions only', () => {
    expect(
      shouldPlanRetrieval({
        question: 'What is the retention policy?',
        hasEvidence: false,
        hasHistory: false,
      }),
    ).toBe(true);
    expect(
      shouldPlanRetrieval({
        question: '它有哪些局限？',
        hasEvidence: true,
        hasHistory: true,
      }),
    ).toBe(true);
    expect(
      shouldPlanRetrieval({
        question: 'Compare the baseline and proposed method.',
        hasEvidence: true,
        hasHistory: false,
      }),
    ).toBe(true);
    expect(
      shouldPlanRetrieval({
        question: 'What threshold is used for calibration?',
        hasEvidence: true,
        hasHistory: false,
      }),
    ).toBe(false);
  });

  it('builds a compact request from the outline, abstract, and recent history', () => {
    const request = buildQueryPlanRequest({
      article,
      question: '它和基线有什么区别？',
      history: [
        ...history,
        {
          id: 'unanswered',
          role: 'user',
          content: 'This failed question must not affect planning.',
          createdAt: 3,
        },
      ],
    });
    const serialized = JSON.stringify(request.messages);

    expect(serialized).toContain('Calibrated Retrieval');
    expect(serialized).toContain('Abstract');
    expect(serialized).toContain('Method');
    expect(serialized).toContain('Results');
    expect(serialized).toContain('conformal calibration');
    expect(serialized).not.toContain(
      'This implementation detail must not be sent to the planner.',
    );
    expect(serialized).not.toContain(
      'This failed question must not affect planning.',
    );
  });

  it('parses fenced JSON, deduplicates queries, and keeps at most three', () => {
    expect(
      parseQueryPlan(
        [
          '```json',
          JSON.stringify({
            rewrittenQuestion:
              'How does conformal calibration differ from the baseline?',
            queries: [
              'conformal calibration method',
              'baseline calibration method',
              'conformal calibration method',
              'evaluation comparison',
            ],
          }),
          '```',
        ].join('\n'),
      ),
    ).toEqual({
      rewrittenQuestion:
        'How does conformal calibration differ from the baseline?',
      queries: [
        'conformal calibration method',
        'baseline calibration method',
        'evaluation comparison',
      ],
    });
  });

  it('falls back cleanly when planning fails or returns invalid JSON', async () => {
    const reject = vi.fn<(request: ModelRequest) => Promise<string>>(
      async () => {
        throw new Error('timeout');
      },
    );
    const invalid = vi.fn<(request: ModelRequest) => Promise<string>>(
      async () => 'not json',
    );
    const input = {
      article,
      question: '它有什么局限？',
      history,
    };

    await expect(planRetrievalQueries(input, reject)).resolves.toBeNull();
    await expect(planRetrievalQueries(input, invalid)).resolves.toBeNull();
  });

  it('returns a validated plan from the completion result', async () => {
    const complete = vi.fn<(request: ModelRequest) => Promise<string>>(
      async () =>
        JSON.stringify({
          rewrittenQuestion:
            'How does conformal calibration differ from the baseline?',
          queries: ['conformal calibration', 'baseline method'],
        }),
    );

    await expect(
      planRetrievalQueries(
        {
          article,
          question: '它和基线有什么区别？',
          history,
        },
        complete,
      ),
    ).resolves.toEqual({
      rewrittenQuestion:
        'How does conformal calibration differ from the baseline?',
      queries: ['conformal calibration', 'baseline method'],
    });
    expect(complete).toHaveBeenCalledOnce();
  });
});
