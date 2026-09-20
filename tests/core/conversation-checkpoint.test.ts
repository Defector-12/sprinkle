import { describe, expect, it } from 'vitest';

import {
  buildConversationCheckpointRequest,
  generateConversationCheckpoint,
  parseConversationCheckpoint,
  prepareConversationCheckpoint,
} from '../../src/core/conversation-checkpoint.ts';
import {
  completedConversationTurns,
  selectConversationMemory,
  type ConversationTurn,
} from '../../src/core/conversation-memory.ts';
import type {
  ChatMessage,
  ConversationCheckpoint,
} from '../../src/core/types.ts';

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

function completedTurns(count: number): ConversationTurn[] {
  return completedConversationTurns(
    Array.from({ length: count }, (_, index) =>
      turn(index, `Question ${index + 1}`, `Answer ${index + 1}`),
    ).flat(),
  );
}

const checkpoint: ConversationCheckpoint = {
  schemaVersion: 1,
  throughMessageId: 'answer-1',
  coveredTurnCount: 2,
  createdAt: 10,
  updatedAt: 10,
  goal: '依次讲解十个问题',
  activeTopic: '问题 2',
  items: [
    { text: '问题 1', status: 'completed' },
    { text: '问题 2', status: 'completed' },
    { text: '问题 3', status: 'pending' },
  ],
  decisions: [],
  userConstraints: ['按顺序逐个讲解'],
  unresolvedReferences: [],
};

describe('conversation checkpoint', () => {
  it('detects only the newly compacted prefix after an existing checkpoint', () => {
    const preparation = prepareConversationCheckpoint(
      checkpoint,
      completedTurns(4),
    );

    expect(preparation).toMatchObject({
      previousCheckpoint: checkpoint,
      throughMessageId: 'answer-3',
      coveredTurnCount: 4,
      needsUpdate: true,
    });
    expect(preparation?.turnsToCompact.map((item) => item.answer.id)).toEqual([
      'answer-2',
      'answer-3',
    ]);
  });

  it('reuses a checkpoint when it already covers the omitted prefix', () => {
    expect(
      prepareConversationCheckpoint(checkpoint, completedTurns(2)),
    ).toMatchObject({
      previousCheckpoint: checkpoint,
      turnsToCompact: [],
      needsUpdate: false,
    });
  });

  it('discards a checkpoint whose message boundary no longer matches history', () => {
    const stale = { ...checkpoint, throughMessageId: 'removed-answer' };
    const preparation = prepareConversationCheckpoint(
      stale,
      completedTurns(3),
    );

    expect(preparation?.previousCheckpoint).toBeNull();
    expect(preparation?.turnsToCompact).toHaveLength(3);
  });

  it('builds a request from completed turns without article content', () => {
    const preparation = prepareConversationCheckpoint(
      null,
      completedTurns(2),
    );
    expect(preparation).not.toBeNull();
    const request = buildConversationCheckpointRequest(preparation!);
    const serialized = JSON.stringify(request.messages);

    expect(serialized).toContain('Question 1');
    expect(serialized).toContain('Answer 2');
    expect(serialized).toContain('按原顺序排列的任务项');
    expect(serialized).not.toContain('<article_context>');
  });

  it('validates a ten-item learning task and assigns trusted metadata locally', () => {
    const raw = JSON.stringify({
      throughMessageId: 'model-controlled',
      coveredTurnCount: 999,
      goal: '依次讲解用户列出的十个问题',
      activeTopic: '已经完成第七项，下一项是第八项',
      items: Array.from({ length: 10 }, (_, index) => ({
        text: `问题 ${index + 1}`,
        status: index < 7 ? 'completed' : index === 7 ? 'active' : 'pending',
      })),
      decisions: ['按照用户原始顺序讲解'],
      userConstraints: ['每次只讲一个问题'],
      unresolvedReferences: ['“下一个”指问题 8'],
    });
    const parsed = parseConversationCheckpoint(raw, {
      previousCheckpoint: checkpoint,
      throughMessageId: 'answer-7',
      coveredTurnCount: 8,
      now: 20,
    });

    expect(parsed).toMatchObject({
      throughMessageId: 'answer-7',
      coveredTurnCount: 8,
      createdAt: 10,
      updatedAt: 20,
      activeTopic: '已经完成第七项，下一项是第八项',
    });
    expect(parsed?.items).toHaveLength(10);
    expect(parsed?.items[7]).toEqual({
      text: '问题 8',
      status: 'active',
    });
  });

  it('rejects invalid status, oversized fields, and malformed JSON', () => {
    const metadata = {
      previousCheckpoint: null,
      throughMessageId: 'answer-1',
      coveredTurnCount: 1,
    };
    expect(
      parseConversationCheckpoint(
        JSON.stringify({
          goal: 'Goal',
          activeTopic: 'Topic',
          items: [{ text: 'Item', status: 'guessed' }],
          decisions: [],
          userConstraints: [],
          unresolvedReferences: [],
        }),
        metadata,
      ),
    ).toBeNull();
    expect(
      parseConversationCheckpoint(
        JSON.stringify({
          goal: 'x'.repeat(601),
          activeTopic: 'Topic',
          items: [],
          decisions: [],
          userConstraints: [],
          unresolvedReferences: [],
        }),
        metadata,
      ),
    ).toBeNull();
    expect(parseConversationCheckpoint('not json', metadata)).toBeNull();
  });

  it('retains the previous checkpoint when generation fails or is invalid', async () => {
    const preparation = prepareConversationCheckpoint(
      checkpoint,
      completedTurns(3),
    );
    expect(preparation).not.toBeNull();

    await expect(
      generateConversationCheckpoint(preparation!, async () => 'not json'),
    ).resolves.toMatchObject({
      checkpoint,
      outcome: 'unavailable',
      error: '会话检查点返回格式无效，已使用原始对话回退。',
    });
    await expect(
      generateConversationCheckpoint(preparation!, async () => {
        throw new Error('timeout');
      }),
    ).resolves.toMatchObject({
      checkpoint,
      outcome: 'unavailable',
      error: 'timeout',
    });
  });

  it('preserves the next item after a ten-item task exceeds raw history', async () => {
    const orderedItems = Array.from(
      { length: 10 },
      (_, index) => `问题 ${index + 1}`,
    );
    const messages = [
      ...turn(
        0,
        `请按顺序讲解：${orderedItems.join('、')}`,
        `问题 1 的讲解 ${'a'.repeat(260)}`,
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        turn(
          index + 1,
          `继续讲问题 ${index + 2}`,
          `问题 ${index + 2} 的讲解 ${'b'.repeat(260)}`,
        ),
      ).flat(),
    ];
    const memory = selectConversationMemory(messages, {
      question: '讲下一个吧',
      characterBudget: 1_200,
      recentCharacterBudget: 1_200,
      recentTurnLimit: 3,
      retrievedTurnLimit: 0,
    });
    const preparation = prepareConversationCheckpoint(
      null,
      memory.compactedPrefixTurns,
    );
    expect(preparation).not.toBeNull();
    expect(
      preparation?.turnsToCompact[0]?.question.content,
    ).toContain('问题 10');

    const generated = await generateConversationCheckpoint(
      preparation!,
      async () =>
        JSON.stringify({
          goal: '按顺序讲解用户列出的十个问题',
          activeTopic: '已完成问题 7，下一项是问题 8',
          items: orderedItems.map((text, index) => ({
            text,
            status:
              index < 7
                ? 'completed'
                : index === 7
                  ? 'active'
                  : 'pending',
          })),
          decisions: ['按原始顺序讲解'],
          userConstraints: ['每次只讲一个问题'],
          unresolvedReferences: ['“下一个”指问题 8'],
        }),
    );

    expect(generated.outcome).toBe('created');
    expect(generated.checkpoint?.items[7]).toEqual({
      text: '问题 8',
      status: 'active',
    });
    expect(generated.checkpoint?.unresolvedReferences).toContain(
      '“下一个”指问题 8',
    );
    expect(memory.messages.at(-1)?.content).toContain('问题 7 的讲解');
  });
});
