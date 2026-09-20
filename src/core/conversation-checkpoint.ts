import type { ConversationTurn } from './conversation-memory.ts';
import { buildConversationCheckpointRequest } from './prompts.ts';
import type {
  ConversationCheckpoint,
  ModelRequest,
} from './types.ts';

export const CONVERSATION_CHECKPOINT_TIMEOUT_MS = 10_000;
export const CONVERSATION_CHECKPOINT_CHARACTER_LIMIT = 4_000;

const GOAL_CHARACTER_LIMIT = 600;
const ACTIVE_TOPIC_CHARACTER_LIMIT = 400;
const ITEM_LIMIT = 30;
const ITEM_CHARACTER_LIMIT = 200;
const LIST_LIMIT = 12;
const LIST_ITEM_CHARACTER_LIMIT = 200;

export interface ConversationCheckpointPreparation {
  previousCheckpoint: ConversationCheckpoint | null;
  turnsToCompact: ConversationTurn[];
  throughMessageId: string;
  coveredTurnCount: number;
  needsUpdate: boolean;
}

export interface ParseConversationCheckpointMetadata {
  previousCheckpoint: ConversationCheckpoint | null;
  throughMessageId: string;
  coveredTurnCount: number;
  now?: number;
}

export interface ConversationCheckpointGeneration {
  checkpoint: ConversationCheckpoint | null;
  outcome: 'created' | 'unavailable';
  error?: string;
}

type CompleteConversationCheckpoint = (
  request: ModelRequest,
) => Promise<string>;

function checkpointMatchesPrefix(
  checkpoint: ConversationCheckpoint | null | undefined,
  compactedPrefixTurns: ConversationTurn[],
): checkpoint is ConversationCheckpoint {
  if (
    !checkpoint ||
    checkpoint.coveredTurnCount < 1 ||
    checkpoint.coveredTurnCount > compactedPrefixTurns.length
  ) {
    return false;
  }
  return (
    compactedPrefixTurns[checkpoint.coveredTurnCount - 1]?.answer.id ===
    checkpoint.throughMessageId
  );
}

export function prepareConversationCheckpoint(
  checkpoint: ConversationCheckpoint | null | undefined,
  compactedPrefixTurns: ConversationTurn[],
): ConversationCheckpointPreparation | null {
  if (!compactedPrefixTurns.length) return null;
  const previousCheckpoint = checkpointMatchesPrefix(
    checkpoint,
    compactedPrefixTurns,
  )
    ? checkpoint
    : null;
  const turnsToCompact = compactedPrefixTurns.slice(
    previousCheckpoint?.coveredTurnCount ?? 0,
  );
  const lastTurn = compactedPrefixTurns.at(-1);
  if (!lastTurn) return null;
  return {
    previousCheckpoint,
    turnsToCompact,
    throughMessageId: lastTurn.answer.id,
    coveredTurnCount: compactedPrefixTurns.length,
    needsUpdate: turnsToCompact.length > 0,
  };
}

export { buildConversationCheckpointRequest } from './prompts.ts';

function validString(
  value: unknown,
  characterLimit: number,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= characterLimit ? normalized : null;
}

function validStringList(
  value: unknown,
  itemLimit: number,
  characterLimit: number,
): string[] | null {
  if (!Array.isArray(value) || value.length > itemLimit) return null;
  const result: string[] = [];
  for (const item of value) {
    const text = validString(item, characterLimit);
    if (text == null) return null;
    if (text) result.push(text);
  }
  return result;
}

export function parseConversationCheckpoint(
  value: string,
  metadata: ParseConversationCheckpointMetadata,
): ConversationCheckpoint | null {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(value.slice(start, end + 1)) as {
      goal?: unknown;
      activeTopic?: unknown;
      items?: unknown;
      decisions?: unknown;
      userConstraints?: unknown;
      unresolvedReferences?: unknown;
    };
    const goal = validString(parsed.goal, GOAL_CHARACTER_LIMIT);
    const activeTopic = validString(
      parsed.activeTopic,
      ACTIVE_TOPIC_CHARACTER_LIMIT,
    );
    if (
      goal == null ||
      activeTopic == null ||
      !Array.isArray(parsed.items) ||
      parsed.items.length > ITEM_LIMIT
    ) {
      return null;
    }

    const items: ConversationCheckpoint['items'] = [];
    for (const item of parsed.items) {
      if (!item || typeof item !== 'object') return null;
      const candidate = item as { text?: unknown; status?: unknown };
      const text = validString(candidate.text, ITEM_CHARACTER_LIMIT);
      if (
        !text ||
        !['pending', 'active', 'completed'].includes(
          String(candidate.status),
        )
      ) {
        return null;
      }
      items.push({
        text,
        status: candidate.status as
          | 'pending'
          | 'active'
          | 'completed',
      });
    }

    const decisions = validStringList(
      parsed.decisions,
      LIST_LIMIT,
      LIST_ITEM_CHARACTER_LIMIT,
    );
    const userConstraints = validStringList(
      parsed.userConstraints,
      LIST_LIMIT,
      LIST_ITEM_CHARACTER_LIMIT,
    );
    const unresolvedReferences = validStringList(
      parsed.unresolvedReferences,
      LIST_LIMIT,
      LIST_ITEM_CHARACTER_LIMIT,
    );
    if (!decisions || !userConstraints || !unresolvedReferences) return null;

    const now = metadata.now ?? Date.now();
    const checkpoint: ConversationCheckpoint = {
      schemaVersion: 1,
      throughMessageId: metadata.throughMessageId,
      coveredTurnCount: metadata.coveredTurnCount,
      createdAt: metadata.previousCheckpoint?.createdAt ?? now,
      updatedAt: now,
      goal,
      activeTopic,
      items,
      decisions,
      userConstraints,
      unresolvedReferences,
    };
    return JSON.stringify(checkpoint).length <=
      CONVERSATION_CHECKPOINT_CHARACTER_LIMIT
      ? checkpoint
      : null;
  } catch {
    return null;
  }
}

export async function generateConversationCheckpoint(
  preparation: ConversationCheckpointPreparation,
  complete: CompleteConversationCheckpoint,
): Promise<ConversationCheckpointGeneration> {
  try {
    const raw = await complete(
      buildConversationCheckpointRequest(preparation),
    );
    const checkpoint = parseConversationCheckpoint(raw, {
      previousCheckpoint: preparation.previousCheckpoint,
      throughMessageId: preparation.throughMessageId,
      coveredTurnCount: preparation.coveredTurnCount,
    });
    return checkpoint
      ? { checkpoint, outcome: 'created' }
      : {
          checkpoint: preparation.previousCheckpoint,
          outcome: 'unavailable',
          error: '会话检查点返回格式无效，已使用原始对话回退。',
        };
  } catch (cause) {
    return {
      checkpoint: preparation.previousCheckpoint,
      outcome: 'unavailable',
      error: cause instanceof Error ? cause.message : '会话检查点生成失败。',
    };
  }
}
