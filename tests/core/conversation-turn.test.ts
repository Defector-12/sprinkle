import { describe, expect, it } from 'vitest';

import {
  completeQuestionTurn,
  snapshotMessageReference,
} from '../../src/core/conversation-turn.ts';
import { buildModelRequest } from '../../src/core/model-request.ts';
import type {
  ArticleDocument,
  ChatMessage,
  PageContext,
} from '../../src/core/types.ts';

const article: ArticleDocument = {
  title: 'Agent memory',
  url: 'https://example.com/agent-memory',
  blocks: [
    {
      id: 'memory',
      type: 'paragraph',
      text: 'The diagram shows working memory flowing through the agent loop.',
      section: 'Architecture',
      order: 0,
    },
  ],
  images: [],
  isPartial: false,
};

const userMessage: ChatMessage = {
  id: 'user-1',
  role: 'user',
  content: '请解释这张图。',
  createdAt: 1,
};

const assistantMessage: ChatMessage = {
  id: 'assistant-1',
  role: 'assistant',
  content: '图中展示了工作记忆在智能体循环中的流转。',
  createdAt: 2,
  answeredBy: 'deepseek',
};

describe('completeQuestionTurn', () => {
  it('creates an immutable reference snapshot for the user message', () => {
    const imageFocus = {
      type: 'image' as const,
      imageUrl: 'data:image/jpeg;base64,diagram',
      alt: 'Agent memory diagram',
      text: 'Working memory flow',
      section: 'Architecture',
      source: 'screenshot' as const,
    };

    const reference = snapshotMessageReference(imageFocus);
    imageFocus.text = 'Changed after sending';

    expect(reference).toEqual({
      type: 'image',
      imageUrl: 'data:image/jpeg;base64,diagram',
      alt: 'Agent memory diagram',
      text: 'Working memory flow',
      section: 'Architecture',
      source: 'screenshot',
    });
    expect(snapshotMessageReference(null)).toBeUndefined();
  });

  it('consumes the image after a successful turn while preserving text history for the next model', () => {
    const answeringContext: PageContext = {
      key: '7:https://example.com/agent-memory',
      tabId: 7,
      url: article.url,
      normalizedUrl: article.url,
      title: article.title,
      status: 'answering',
      article,
      focus: {
        type: 'image',
        imageUrl: 'data:image/jpeg;base64,diagram',
        alt: 'Agent memory diagram',
        text: 'Working memory flow',
        section: 'Architecture',
        source: 'screenshot',
      },
      messages: [userMessage],
      warning: null,
      updatedAt: 1,
    };

    const completed = completeQuestionTurn(
      answeringContext,
      assistantMessage,
    );
    const followUpRequest = buildModelRequest({
      article,
      question: '它为什么需要循环？',
      relevantChunks: [],
      history: completed.messages,
      focus: completed.focus,
    });
    const serialized = JSON.stringify(followUpRequest);

    expect(completed.focus).toBeNull();
    expect(completed.messages).toEqual([userMessage, assistantMessage]);
    expect(completed.messages.at(-1)?.answeredBy).toBe('deepseek');
    expect(followUpRequest.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(serialized).toContain(userMessage.content);
    expect(serialized).toContain(assistantMessage.content);
    expect(serialized).not.toContain('image_url');
    expect(serialized).not.toContain('data:image/jpeg');
  });
});
