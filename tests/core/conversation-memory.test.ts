import { describe, expect, it } from 'vitest';

import {
  HISTORY_CHARACTER_BUDGET,
  selectConversationHistory,
  selectConversationMemory,
} from '../../src/core/conversation-memory.ts';
import type { ChatMessage } from '../../src/core/types.ts';

function turn(index: number, question: string, answer: string): ChatMessage[] {
  return [
    {
      id: `question-${index}`,
      role: 'user',
      content: question,
      createdAt: index * 2,
    },
    {
      id: `answer-${index}`,
      role: 'assistant',
      content: answer,
      createdAt: index * 2 + 1,
    },
  ];
}

describe('selectConversationHistory', () => {
  it('keeps every completed turn while the history fits the budget', () => {
    const history = [
      ...turn(0, 'Question zero', 'Answer zero'),
      ...turn(1, 'Question one', 'Answer one'),
      {
        id: 'unanswered',
        role: 'user' as const,
        content: 'Unanswered',
        createdAt: 5,
      },
      {
        id: 'failed-answer',
        role: 'assistant' as const,
        content: 'Failed answer',
        createdAt: 6,
        error: true,
      },
    ];

    expect(
      selectConversationHistory(history, { question: 'Follow up' }),
    ).toEqual([
      { role: 'user', content: 'Question zero' },
      { role: 'assistant', content: 'Answer zero' },
      { role: 'user', content: 'Question one' },
      { role: 'assistant', content: 'Answer one' },
    ]);
  });

  it('combines recent turns with relevant history from any age', () => {
    const history = [
      ...turn(
        0,
        'How does checkpoint recovery work?',
        'Checkpoint recovery restores durable state before event replay.',
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        turn(
          index + 1,
          `Unrelated question ${index}`,
          `Unrelated answer ${index} ${'x'.repeat(7_000)}`,
        ),
      ).flat(),
    ];

    const selected = selectConversationHistory(history, {
      question: 'Why does checkpoint recovery replay events?',
    });
    const serialized = JSON.stringify(selected);

    expect(serialized).toContain('Checkpoint recovery restores durable state');
    expect(serialized).toContain('Unrelated question 7');
    expect(
      selected.reduce(
        (length, message) => length + String(message.content).length,
        0,
      ),
    ).toBeLessThanOrEqual(HISTORY_CHARACTER_BUDGET);
  });

  it('uses archived reference metadata when recalling an old visual question', () => {
    const visualTurn = turn(
      0,
      'Explain this image.',
      'The chart shows a durable write before acknowledgement.',
    );
    visualTurn[0] = {
      ...visualTurn[0]!,
      reference: {
        type: 'image',
        alt: 'checkpoint commit timeline',
        text: '',
        section: 'Storage',
        source: 'screenshot',
      },
    };
    const history = [
      ...visualTurn,
      ...Array.from({ length: 8 }, (_, index) =>
        turn(
          index + 1,
          `Recent question ${index}`,
          `Recent answer ${index} ${'z'.repeat(7_000)}`,
        ),
      ).flat(),
    ];

    const selected = selectConversationHistory(history, {
      question: 'What did the checkpoint timeline show?',
    });

    expect(JSON.stringify(selected)).toContain(
      'The chart shows a durable write before acknowledgement.',
    );
  });

  it('honors a caller-provided shared context budget', () => {
    const history = [
      ...turn(0, 'Old question', `Old answer ${'x'.repeat(300)}`),
      ...turn(1, 'Recent question', `Recent answer ${'y'.repeat(300)}`),
    ];

    const selected = selectConversationHistory(history, {
      question: 'Recent question',
      characterBudget: 350,
      recentCharacterBudget: 350,
      recentTurnLimit: 1,
      retrievedTurnLimit: 0,
    });
    const length = selected.reduce(
      (total, message) => total + String(message.content).length,
      0,
    );

    expect(length).toBeLessThanOrEqual(350);
    expect(JSON.stringify(selected)).toContain('Recent question');
    expect(JSON.stringify(selected)).not.toContain('Old question');
  });

  it('keeps recent raw turns verbatim and reports the compacted prefix', () => {
    const history = [
      ...turn(0, 'Original ten-item task', `Initial ${'x'.repeat(300)}`),
      ...turn(1, 'First item', `First answer ${'y'.repeat(300)}`),
      ...turn(2, 'Second item', `Second answer ${'z'.repeat(300)}`),
    ];
    const selection = selectConversationMemory(history, {
      question: '讲下一个吧',
      characterBudget: 700,
      recentCharacterBudget: 700,
      recentTurnLimit: 2,
      retrievedTurnLimit: 0,
    });

    expect(selection.messages).toEqual([
      { role: 'user', content: 'First item' },
      { role: 'assistant', content: `First answer ${'y'.repeat(300)}` },
      { role: 'user', content: 'Second item' },
      { role: 'assistant', content: `Second answer ${'z'.repeat(300)}` },
    ]);
    expect(selection.compactedPrefixTurns.map((item) => item.question.id))
      .toEqual(['question-0']);
    expect(selection).toMatchObject({
      recentTurnCount: 2,
      recalledTurnCount: 0,
      omittedTurnCount: 1,
    });
  });
});
