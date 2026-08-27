import { overlapScore, tokensFor } from './retrieval.ts';
import type { ChatMessage, ModelMessage } from './types.ts';

export const HISTORY_CHARACTER_BUDGET = 48_000;
export const RECENT_HISTORY_CHARACTER_BUDGET = 24_000;
export const RECENT_HISTORY_TURN_LIMIT = 6;
export const RETRIEVED_HISTORY_TURN_LIMIT = 6;

interface ConversationTurn {
  index: number;
  question: ChatMessage;
  answer: ChatMessage;
}

function completedTurns(messages: ChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const question = messages[index];
    const answer = messages[index + 1];
    if (
      question?.role !== 'user' ||
      answer?.role !== 'assistant' ||
      question.error ||
      answer.error
    ) {
      continue;
    }
    turns.push({ index, question, answer });
    index += 1;
  }
  return turns;
}

function turnLength(turn: ConversationTurn): number {
  return turn.question.content.length + turn.answer.content.length;
}

function referenceText(message: ChatMessage): string {
  const reference = message.reference;
  if (!reference) return '';
  return [
    reference.text,
    reference.section,
    reference.type === 'image' ? reference.alt : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const marker = '\n[较早内容已截断]\n';
  if (limit <= marker.length) return value.slice(0, Math.max(0, limit));
  const available = limit - marker.length;
  const startLength = Math.ceil(available * 0.7);
  return `${value.slice(0, startLength)}${marker}${value.slice(
    value.length - (available - startLength),
  )}`;
}

function fitTurn(
  turn: ConversationTurn,
  budget: number,
): ConversationTurn | null {
  if (budget <= 0) return null;
  if (turnLength(turn) <= budget) return turn;
  const questionBudget = Math.min(
    turn.question.content.length,
    Math.max(1, Math.floor(budget * 0.35)),
  );
  const answerBudget = Math.max(0, budget - questionBudget);
  return {
    ...turn,
    question: {
      ...turn.question,
      content: truncate(turn.question.content, questionBudget),
    },
    answer: {
      ...turn.answer,
      content: truncate(turn.answer.content, answerBudget),
    },
  };
}

function asModelMessages(turns: ConversationTurn[]): ModelMessage[] {
  return turns.flatMap((turn) => [
    { role: 'user', content: turn.question.content },
    { role: 'assistant', content: turn.answer.content },
  ]);
}

export interface ConversationMemoryQuery {
  question: string;
  focusText?: string;
}

export function selectConversationHistory(
  messages: ChatMessage[],
  query: ConversationMemoryQuery,
): ModelMessage[] {
  const turns = completedTurns(messages);
  const totalLength = turns.reduce(
    (sum, turn) => sum + turnLength(turn),
    0,
  );
  if (totalLength <= HISTORY_CHARACTER_BUDGET) {
    return asModelMessages(turns);
  }

  const recentCandidates = turns.slice(-RECENT_HISTORY_TURN_LIMIT);
  const recent: ConversationTurn[] = [];
  let recentLength = 0;
  for (const turn of recentCandidates.toReversed()) {
    const remaining = RECENT_HISTORY_CHARACTER_BUDGET - recentLength;
    const selected = fitTurn(turn, remaining);
    if (!selected) break;
    recent.push(selected);
    recentLength += turnLength(selected);
    if (turnLength(turn) > remaining) break;
  }

  const recentIndexes = new Set(recent.map((turn) => turn.index));
  const queryTokens = tokensFor(
    `${query.question}\n${query.focusText ?? ''}`,
  );
  const olderCandidates = turns
    .filter((turn) => !recentIndexes.has(turn.index))
    .map((turn) => ({
      turn,
      score: overlapScore(
        queryTokens,
        [
          turn.question.content,
          turn.answer.content,
          referenceText(turn.question),
        ].join('\n'),
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || right.turn.index - left.turn.index,
    )
    .slice(0, RETRIEVED_HISTORY_TURN_LIMIT);

  const recalled: ConversationTurn[] = [];
  let recalledLength = 0;
  const recalledBudget = HISTORY_CHARACTER_BUDGET - recentLength;
  for (const candidate of olderCandidates) {
    const remaining = recalledBudget - recalledLength;
    const selected = fitTurn(candidate.turn, remaining);
    if (!selected) break;
    recalled.push(selected);
    recalledLength += turnLength(selected);
    if (turnLength(candidate.turn) > remaining) break;
  }

  return asModelMessages(
    [...recalled, ...recent].sort((left, right) => left.index - right.index),
  );
}
