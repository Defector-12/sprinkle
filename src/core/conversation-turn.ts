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

export function failQuestionTurn(
  answeringContext: PageContext,
  questionId: string,
): PageContext {
  return {
    ...answeringContext,
    status: answeringContext.article?.isPartial ? 'partial' : 'ready',
    messages: answeringContext.messages.map((message) =>
      message.id === questionId ? { ...message, error: true } : message,
    ),
    updatedAt: Date.now(),
  };
}

export function recoverInterruptedQuestionTurn(
  context: PageContext,
): PageContext {
  if (context.status !== 'answering') return context;
  const pendingQuestion = context.messages.findLast(
    (message) => message.role === 'user',
  );
  if (!pendingQuestion) {
    return {
      ...context,
      status: context.article?.isPartial ? 'partial' : 'ready',
      updatedAt: Date.now(),
    };
  }
  return failQuestionTurn(context, pendingQuestion.id);
}
