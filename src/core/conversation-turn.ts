import type {
  ChatMessage,
  FocusContext,
  MessageReference,
  PageContext,
} from './types.ts';

export function snapshotMessageReference(
  focus: FocusContext | null,
): MessageReference | undefined {
  return focus ? { ...focus } : undefined;
}

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
