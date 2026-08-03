import type { ChatMessage, PageContext } from './types.ts';

export function completeQuestionTurn(
  answeringContext: PageContext,
  assistantMessage: ChatMessage,
): PageContext {
  return {
    ...answeringContext,
    status: answeringContext.article?.isPartial ? 'partial' : 'ready',
    focus: null,
    messages: [...answeringContext.messages, assistantMessage],
    updatedAt: Date.now(),
  };
}
