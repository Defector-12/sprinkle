import { overlapScore, tokensFor } from './retrieval.ts';
import type { ChatMessage, ModelMessage } from './types.ts';

export const HISTORY_CHARACTER_BUDGET = 48_000;
export const RECENT_HISTORY_CHARACTER_BUDGET = 24_000;
export const RECENT_HISTORY_TURN_LIMIT = 6;
export const RETRIEVED_HISTORY_TURN_LIMIT = 6;

export interface ConversationTurn {
  index: number;
  question: ChatMessage;
  answer: ChatMessage;
}

export function completedConversationTurns(
  messages: ChatMessage[],
): ConversationTurn[] {
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

function fitTurn(
  turn: ConversationTurn,
  budget: number,
): ConversationTurn | null {
  if (budget <= 0) return null;
  return turnLength(turn) <= budget ? turn : null;
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
  characterBudget?: number;
  recentCharacterBudget?: number;
  recentTurnLimit?: number;
  retrievedTurnLimit?: number;
}

export interface ConversationMemorySelection {
  messages: ModelMessage[];
  selectedTurns: ConversationTurn[];
  recentTurnCount: number;
  recalledTurnCount: number;
  omittedTurnCount: number;
  compactedPrefixTurns: ConversationTurn[];
}

export function selectConversationMemory(
  messages: ChatMessage[],
  query: ConversationMemoryQuery,
): ConversationMemorySelection {
  const turns = completedConversationTurns(messages);
  const characterBudget = Math.max(
    0,
    query.characterBudget ?? HISTORY_CHARACTER_BUDGET,
  );
  if (characterBudget === 0) {
    return {
      messages: [],
      selectedTurns: [],
      recentTurnCount: 0,
      recalledTurnCount: 0,
      omittedTurnCount: turns.length,
      compactedPrefixTurns: turns,
    };
  }
  const totalLength = turns.reduce(
    (sum, turn) => sum + turnLength(turn),
    0,
  );
  if (totalLength <= characterBudget) {
    return {
      messages: asModelMessages(turns),
      selectedTurns: turns,
      recentTurnCount: turns.length,
      recalledTurnCount: 0,
      omittedTurnCount: 0,
      compactedPrefixTurns: [],
    };
  }

  const recentCharacterBudget = Math.min(
    characterBudget,
    Math.max(
      0,
      query.recentCharacterBudget ??
        RECENT_HISTORY_CHARACTER_BUDGET,
    ),
  );
  const recentCandidates = turns.slice(
    -Math.max(0, query.recentTurnLimit ?? RECENT_HISTORY_TURN_LIMIT),
  );
  const recent: ConversationTurn[] = [];
  let recentLength = 0;
  for (const turn of recentCandidates.toReversed()) {
    const remaining = recentCharacterBudget - recentLength;
    const selected = fitTurn(turn, remaining);
    if (!selected) break;
    recent.push(selected);
    recentLength += turnLength(selected);
    if (turnLength(turn) > remaining) break;
  }

  const recentWindowIndexes = new Set(
    recentCandidates.map((turn) => turn.index),
  );
  const queryTokens = tokensFor(
    `${query.question}\n${query.focusText ?? ''}`,
  );
  const olderCandidates = turns
    .filter((turn) => !recentWindowIndexes.has(turn.index))
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
    .slice(
      0,
      Math.max(
        0,
        query.retrievedTurnLimit ?? RETRIEVED_HISTORY_TURN_LIMIT,
      ),
    );

  const recalled: ConversationTurn[] = [];
  let recalledLength = 0;
  const recalledBudget = characterBudget - recentLength;
  for (const candidate of olderCandidates) {
    const remaining = recalledBudget - recalledLength;
    const selected = fitTurn(candidate.turn, remaining);
    if (!selected) continue;
    recalled.push(selected);
    recalledLength += turnLength(selected);
  }

  const selectedTurns = [...recalled, ...recent].sort(
    (left, right) => left.index - right.index,
  );
  const selectedIndexes = new Set(selectedTurns.map((turn) => turn.index));
  const firstRecentIndex = recent.length
    ? Math.min(...recent.map((turn) => turn.index))
    : undefined;
  const compactedPrefixTurns =
    firstRecentIndex == null
      ? turns
      : turns.filter((turn) => turn.index < firstRecentIndex);
  return {
    messages: asModelMessages(selectedTurns),
    selectedTurns,
    recentTurnCount: recent.length,
    recalledTurnCount: recalled.length,
    omittedTurnCount: turns.filter((turn) => !selectedIndexes.has(turn.index))
      .length,
    compactedPrefixTurns,
  };
}

export function selectConversationHistory(
  messages: ChatMessage[],
  query: ConversationMemoryQuery,
): ModelMessage[] {
  return selectConversationMemory(messages, query).messages;
}
