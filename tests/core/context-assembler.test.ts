import { describe, expect, it } from 'vitest';

import {
  assembleQuestionContext,
  REQUEST_CONTEXT_CHARACTER_BUDGET,
} from '../../src/core/context-assembler.ts';
import type { QueryPlan } from '../../src/core/query-planner.ts';
import type {
  ArticleChunk,
  ArticleDocument,
  ChatMessage,
  ConversationCheckpoint,
} from '../../src/core/types.ts';

const article: ArticleDocument = {
  title: 'Agent Architecture',
  url: 'https://example.com/agent',
  blocks: [],
  images: [],
  isPartial: false,
};

function chunk(
  id: string,
  section: string,
  text: string,
): ArticleChunk {
  return {
    id,
    section,
    text,
    blockIds: [`block-${id}`],
  };
}

const definition = chunk(
  'definition',
  '2.1 事件源：10 种 AgentEvent',
  [
    'Agent 内核层定义了 10 种 AgentEvent。',
    'agent_start agent_end turn_start turn_end ',
    'message_start message_update message_end ',
    'tool_execution_start tool_execution_update tool_execution_end',
  ].join(''),
);
const selectedReference = chunk(
  'selected',
  '3.3 管道 A 能收到哪些事件',
  'AgentSessionEvent 包含内核 10 种生命周期事件，以及产品级事件。',
);
const checkpoint: ConversationCheckpoint = {
  schemaVersion: 1,
  throughMessageId: 'answer-7',
  coveredTurnCount: 8,
  createdAt: 1,
  updatedAt: 2,
  goal: '依次讲解十个问题',
  activeTopic: '问题 8',
  items: [{ text: '问题 8', status: 'active' }],
  decisions: [],
  userConstraints: [],
  unresolvedReferences: ['“下一个”指问题 8'],
};

describe('assembleQuestionContext', () => {
  it('uses the complete article when article and memory fit one budget', () => {
    const history: ChatMessage[] = [
      {
        id: 'question-1',
        role: 'user',
        content: 'What is an event?',
        createdAt: 1,
      },
      {
        id: 'answer-1',
        role: 'assistant',
        content: 'An event describes something that happened.',
        createdAt: 2,
      },
    ];
    const result = assembleQuestionContext({
      article,
      chunks: [definition, selectedReference],
      question: '内核 10 种事件是什么？',
      focus: {
        type: 'text',
        text: '内核 10 种事件',
        section: selectedReference.section,
      },
      history,
    });

    expect(result.strategy).toBe('full-context');
    expect(result.mode).toBe('whole');
    expect(result.needsPlanning).toBe(false);
    expect(result.chunks).toEqual([definition, selectedReference]);
    expect(JSON.stringify(result.history)).toContain('What is an event?');
    expect(result.budget.articleCharacters).toBeLessThan(
      REQUEST_CONTEXT_CHARACTER_BUDGET,
    );
  });

  it('keeps a fitting article whole and gives only the remaining budget to memory', () => {
    const nearLimit = chunk(
      'near-limit',
      'Main',
      'a'.repeat(920),
    );
    const history: ChatMessage[] = [
      {
        id: 'question-1',
        role: 'user',
        content: 'Previous question',
        createdAt: 1,
      },
      {
        id: 'answer-1',
        role: 'assistant',
        content: `Previous answer ${'b'.repeat(400)}`,
        createdAt: 2,
      },
    ];
    const result = assembleQuestionContext({
      article,
      chunks: [nearLimit],
      question: 'Current question',
      focus: null,
      history,
      characterBudget: 1_000,
    });

    expect(result.strategy).toBe('full-context');
    expect(result.chunks).toEqual([nearLimit]);
    expect(result.budget.historyCharacters).toBeLessThanOrEqual(
      1_000 - result.budget.articleCharacters,
    );
  });

  it('counts a conversation checkpoint against the shared context budget', () => {
    const nearLimit = chunk('near-limit', 'Main', 'a'.repeat(820));
    const withoutCheckpoint = assembleQuestionContext({
      article,
      chunks: [nearLimit],
      question: 'Current question',
      focus: null,
      history: [],
      characterBudget: 1_000,
      planningComplete: true,
    });
    const withCheckpoint = assembleQuestionContext({
      article,
      chunks: [nearLimit],
      question: '讲下一个吧',
      focus: null,
      history: [],
      conversationCheckpoint: checkpoint,
      characterBudget: 1_000,
      planningComplete: true,
    });

    expect(withoutCheckpoint.strategy).toBe('full-context');
    expect(withCheckpoint.strategy).toBe('fused-retrieval');
    expect(withCheckpoint.budget.checkpointCharacters).toBeGreaterThan(0);
    expect(
      withCheckpoint.budget.articleCharacters +
        withCheckpoint.budget.historyCharacters +
        withCheckpoint.budget.checkpointCharacters,
    ).toBeLessThanOrEqual(1_000);
  });

  it('keeps the focus anchor and adds global evidence when retrieval is required', () => {
    const filler = chunk('filler', 'Appendix', 'x'.repeat(2_000));
    const result = assembleQuestionContext({
      article,
      chunks: [definition, filler, selectedReference],
      question: '内核 10 种事件是啥？',
      focus: {
        type: 'text',
        text: '内核 10 种事件',
        section: selectedReference.section,
      },
      history: [],
      planningComplete: true,
      characterBudget: 1_200,
    });

    expect(result.strategy).toBe('fused-retrieval');
    expect(result.needsPlanning).toBe(false);
    expect(result.chunks).toContain(selectedReference);
    expect(
      result.chunks.some(
        (item) =>
          item.section === definition.section &&
          item.text.includes('tool_execution_end'),
      ),
    ).toBe(true);
    expect(result.evidence.find((item) => item.chunk === selectedReference))
      .toMatchObject({
        pinned: true,
        sources: expect.arrayContaining(['focus-anchor']),
      });
    expect(
      result.evidence.find(
        (item) => item.chunk.section === definition.section,
      ),
    )
      .toMatchObject({
        sources: expect.arrayContaining(['global-search']),
      });
  });

  it('fuses exact-match and BM25 windows that share source blocks', () => {
    const exact = chunk(
      'exact-api',
      'API',
      'Use session.subscribe to receive lifecycle events.',
    );
    const result = assembleQuestionContext({
      article,
      chunks: [
        exact,
        chunk('filler', 'Appendix', 'z'.repeat(2_000)),
      ],
      question: 'What does `session.subscribe` receive?',
      focus: null,
      history: [],
      planningComplete: true,
      characterBudget: 800,
    });
    const evidence = result.evidence.find((item) =>
      item.chunk.blockIds.includes('block-exact-api'),
    );

    expect(evidence).toMatchObject({
      sources: expect.arrayContaining(['exact-match', 'global-search']),
    });
    expect(
      result.evidence.filter((item) =>
        item.chunk.blockIds.includes('block-exact-api'),
      ),
    ).toHaveLength(1);
  });

  it('uses planner evidence needs to cover relationships outside a selected section', () => {
    const focusSection = chunk(
      'working-memory',
      'Architecture > Working memory',
      'Working memory holds the current reasoning state.',
    );
    const relatedSection = chunk(
      'durable-memory',
      'Architecture > Durable memory',
      'Durable memory persists selected state across sessions.',
    );
    const filler = chunk('large-background', 'Background', 'z'.repeat(2_000));
    const plan: QueryPlan = {
      rewrittenQuestion:
        'How does working memory relate to durable memory?',
      queries: ['working memory durable memory relationship'],
      evidenceNeeds: [
        {
          query: 'durable memory persists state across sessions',
          reason: '需要找到与所选章节相关的持久记忆机制。',
        },
      ],
      coverage: 'multi-section',
      useConversation: false,
    };

    const result = assembleQuestionContext({
      article,
      chunks: [focusSection, filler, relatedSection],
      question: '这个章节和其他章节的关系是什么？',
      focus: {
        type: 'text',
        text: 'Working memory',
        section: focusSection.section,
        scope: 'section',
        headingLevel: 2,
      },
      history: [],
      plan,
      planningComplete: true,
      characterBudget: 1_200,
    });

    expect(result.chunks).toContain(focusSection);
    expect(
      result.chunks.some(
        (item) => item.section === relatedSection.section,
      ),
    ).toBe(true);
    expect(
      result.evidence.find(
        (item) => item.chunk.section === relatedSection.section,
      ),
    )
      .toMatchObject({
        reasons: expect.arrayContaining([
          '需要找到与所选章节相关的持久记忆机制。',
        ]),
      });
  });

  it('falls back to deterministic fusion after planning is unavailable', () => {
    const filler = chunk('filler', 'Appendix', 'x'.repeat(2_000));
    const initial = assembleQuestionContext({
      article,
      chunks: [definition, filler, selectedReference],
      question: '内核 10 种事件是啥？',
      focus: null,
      history: [],
      characterBudget: 1_200,
    });
    const fallback = assembleQuestionContext({
      article,
      chunks: [definition, filler, selectedReference],
      question: '内核 10 种事件是啥？',
      focus: null,
      history: [],
      planningComplete: true,
      characterBudget: 1_200,
    });

    expect(initial.needsPlanning).toBe(true);
    expect(fallback.needsPlanning).toBe(false);
    expect(
      fallback.chunks.some((item) =>
        item.text.includes('tool_execution_end'),
      ),
    ).toBe(true);
  });

  it('keeps document-wide coverage for an oversized whole-article question', () => {
    const chunks = Array.from({ length: 12 }, (_, index) =>
      chunk(
        `section-${index}`,
        `Section ${index}`,
        `${index} ${'x'.repeat(220)}`,
      ),
    );
    const result = assembleQuestionContext({
      article,
      chunks,
      question: '请总结全文',
      focus: null,
      history: [],
      planningComplete: true,
      characterBudget: 1_200,
    });
    const selectedIndexes = result.chunks.map((item) =>
      chunks.findIndex((candidate) => candidate.id === item.id),
    );

    expect(result.strategy).toBe('fused-retrieval');
    expect(selectedIndexes[0]).toBe(0);
    expect(selectedIndexes).toContain(11);
    expect(
      selectedIndexes.some((index) => index >= 4 && index <= 7),
    ).toBe(true);
  });

  it('does not let document coverage evict focus or required planner evidence', () => {
    const chunks = Array.from({ length: 12 }, (_, index) =>
      chunk(
        `section-${index}`,
        `Section ${index}`,
        `${index} ${'x'.repeat(220)}`,
      ),
    );
    chunks[5] = chunk(
      'required',
      'Section 5',
      `durable checkpoint evidence ${'y'.repeat(200)}`,
    );
    const plan: QueryPlan = {
      rewrittenQuestion: 'Summarize the document and explain the checkpoint.',
      queries: ['document checkpoint'],
      evidenceNeeds: [
        {
          query: 'durable checkpoint evidence',
          reason: '需要检查持久检查点。',
        },
      ],
      coverage: 'document-wide',
      useConversation: false,
    };
    const result = assembleQuestionContext({
      article,
      chunks,
      question: '请总结全文，并解释这个检查点',
      focus: {
        type: 'text',
        text: '0',
        section: 'Section 0',
      },
      history: [],
      plan,
      planningComplete: true,
      characterBudget: 1_900,
    });

    expect(
      result.evidence.some(
        (item) =>
          item.pinned && item.chunk.blockIds.includes('block-section-0'),
      ),
    ).toBe(true);
    expect(
      result.evidence.some((item) =>
        item.chunk.blockIds.includes('block-required'),
      ),
    ).toBe(true);
    expect(result.evidence.length).toBeLessThanOrEqual(8);
  });
});
