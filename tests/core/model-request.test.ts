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
});
