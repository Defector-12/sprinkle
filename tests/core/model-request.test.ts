import { describe, expect, it } from 'vitest';

import { buildModelRequest } from '../../src/core/model-request.ts';
import type {
  ArticleDocument,
  ChatMessage,
  FocusContext,
} from '../../src/core/types.ts';

const article: ArticleDocument = {
  title: 'Agent memory',
  url: 'https://example.com/agent-memory',
  blocks: [
    {
      id: 'memory',
      type: 'paragraph',
      text: 'Short-term memory keeps the current task state.',
      section: 'Memory types',
      order: 0,
    },
  ],
  images: [],
  isPartial: false,
};

describe('buildModelRequest', () => {
  it('instructs the model to answer in article context without showing sources', () => {
    const request = buildModelRequest({
      article,
      question: 'What does short-term memory mean here?',
      relevantChunks: [
        {
          id: 'chunk-1',
          section: 'Memory types',
          text: 'Short-term memory keeps the current task state.',
          blockIds: ['memory'],
        },
      ],
      history: [],
      focus: {
        type: 'text',
        text: 'Short-term memory',
        section: 'Memory types',
      },
    });

    expect(request.messages[0]?.content).toContain(
      '优先依据当前文章语境回答',
    );
    expect(request.messages[0]?.content).toContain('不要提供原文出处');
    expect(request.messages[0]?.content).not.toContain(
      'Short-term memory keeps the current task state.',
    );
    expect(request.messages.at(-1)?.content).toContain(
      '<article_context>',
    );
    expect(JSON.stringify(request.messages)).toContain('Short-term memory');
  });

  it('includes recent conversation for follow-up questions', () => {
    const history: ChatMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Explain the diagram.',
        createdAt: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'It shows memory flowing into the agent.',
        createdAt: 2,
      },
    ];

    const request = buildModelRequest({
      article,
      question: 'Why is it temporary?',
      relevantChunks: [],
      history,
      focus: null,
    });

    expect(request.messages.map((item) => item.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
  });

  it('excludes unanswered history and keeps complete history within budget', () => {
    const history: ChatMessage[] = Array.from({ length: 5 }, (_, index) => [
      {
        id: `user-${index}`,
        role: 'user' as const,
        content: `Question ${index}`,
        createdAt: index * 2,
      },
      {
        id: `assistant-${index}`,
        role: 'assistant' as const,
        content: `Answer ${index}`,
        createdAt: index * 2 + 1,
      },
    ]).flat();
    history.push({
      id: 'failed-user',
      role: 'user',
      content: 'Unanswered question',
      createdAt: 20,
    });

    const request = buildModelRequest({
      article,
      question: 'Current question',
      relevantChunks: [],
      history,
      focus: null,
    });
    const historyMessages = request.messages.slice(1, -1);

    expect(historyMessages).toHaveLength(10);
    expect(historyMessages[0]?.content).toBe('Question 0');
    expect(historyMessages.at(-1)?.content).toBe('Answer 4');
    expect(JSON.stringify(request)).not.toContain('Unanswered question');
  });

  it('recalls an older completed turn when it is relevant to the current question', () => {
    const history: ChatMessage[] = Array.from({ length: 7 }, (_, index) => [
      {
        id: `user-${index}`,
        role: 'user' as const,
        content:
          index === 0
            ? 'How does the checkpoint coordinator recover state?'
            : `Question ${index} about an unrelated topic`,
        createdAt: index * 2,
      },
      {
        id: `assistant-${index}`,
        role: 'assistant' as const,
        content:
          index === 0
            ? 'It restores the latest durable checkpoint before replaying events.'
            : `Answer ${index}`,
        createdAt: index * 2 + 1,
      },
    ]).flat();

    const request = buildModelRequest({
      article,
      question: 'Why does checkpoint recovery replay events?',
      relevantChunks: [],
      history,
      focus: null,
    });

    expect(JSON.stringify(request.messages)).toContain(
      'It restores the latest durable checkpoint before replaying events.',
    );
  });

  it('adds a selected image to a multimodal user message', () => {
    const focus: FocusContext = {
      type: 'image',
      imageUrl: 'https://example.com/diagram.png',
      alt: 'Agent memory diagram',
      text: 'Memory types',
      section: 'Memory types',
      source: 'original',
    };

    const request = buildModelRequest({
      article,
      question: 'Explain this diagram.',
      relevantChunks: [],
      history: [],
      focus,
    });

    const lastMessage = request.messages.at(-1);
    expect(lastMessage?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image_url' }),
      ]),
    );
  });

  it('labels whole-article context and discloses budget truncation', () => {
    const request = buildModelRequest({
      article,
      question: '总结全文',
      relevantChunks: [
        {
          id: 'chunk-1',
          section: 'Memory types',
          text: 'Short-term memory keeps the current task state.',
          blockIds: ['memory'],
        },
      ],
      history: [],
      focus: null,
      contextMode: 'whole',
      contextTruncated: true,
    });
    const serialized = JSON.stringify(request.messages);

    expect(serialized).toContain('当前已解析到的文章全文');
    expect(serialized).toContain('按全文位置均匀选取');
    expect(serialized).not.toContain('当前页面内容已完成解析');
  });

  it('confirms when the parsed whole article fits in the request', () => {
    const request = buildModelRequest({
      article,
      question: '总结全文',
      relevantChunks: [],
      history: [],
      focus: null,
      contextMode: 'whole',
      contextTruncated: false,
    });
    const serialized = JSON.stringify(request.messages);

    expect(serialized).toContain('本次请求包含当前已解析到的文章全文');
    expect(serialized).not.toContain('按全文位置均匀选取');
  });
});
