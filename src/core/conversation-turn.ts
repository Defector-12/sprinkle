import type {
  ChatMessage,
  FocusContext,
  MessageReference,
  PageContext,
  QuestionTrace,
} from './types.ts';
import { interruptQuestionTrace } from './question-trace.ts';

const RETAINED_QUESTION_TRACE_LIMIT = 10;

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

export function setQuestionTrace(
  context: PageContext,
  questionId: string,
  trace: QuestionTrace,
): PageContext {
  return {
    ...context,
    messages: context.messages.map((message) =>
      message.id === questionId ? { ...message, trace } : message,
    ),
    updatedAt: Date.now(),
  };
}

export function retainRecentQuestionTraces(
  messages: ChatMessage[],
  limit = RETAINED_QUESTION_TRACE_LIMIT,
): ChatMessage[] {
  const retainedIds = new Set(
    messages
      .filter((message) => message.role === 'user' && message.trace)
      .slice(-Math.max(0, limit))
      .map((message) => message.id),
  );
  return messages.map((message) => {
    if (!message.trace || retainedIds.has(message.id)) return message;
    const { trace: _trace, ...withoutTrace } = message;
    return withoutTrace;
  });
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
  const interrupted = pendingQuestion.trace
    ? setQuestionTrace(
        context,
        pendingQuestion.id,
        interruptQuestionTrace(pendingQuestion.trace),
      )
    : context;
  return failQuestionTurn(interrupted, pendingQuestion.id);
}
