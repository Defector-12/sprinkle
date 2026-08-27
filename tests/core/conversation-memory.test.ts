import { describe, expect, it } from 'vitest';

import {
  HISTORY_CHARACTER_BUDGET,
  selectConversationHistory,
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
});
