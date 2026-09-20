import {
  selectConversationMemory,
  type ConversationMemorySelection,
} from './conversation-memory.ts';
import type { QueryPlan } from './query-planner.ts';
import {
  DEFAULT_RELEVANT_CHUNK_LIMIT,
  isWholeArticleQuestion,
  retrieveExactMatchChunks,
  retrieveRelevantChunks,
  selectDocumentCoverage,
  type ArticleContextMode,
} from './retrieval.ts';
import type {
  ArticleChunk,
  ArticleDocument,
  ChatMessage,
  ConversationCheckpoint,
  FocusContext,
  ModelMessage,
} from './types.ts';

export const REQUEST_CONTEXT_CHARACTER_BUDGET = 64_000;
const DEFAULT_RETRIEVED_HISTORY_BUDGET = 8_000;
const PLANNED_HISTORY_BUDGET = 16_000;
const FOCUS_ANCHOR_LIMIT = 3;
const EVIDENCE_NEED_LIMIT = 3;
const DOCUMENT_COVERAGE_BUDGET = 8_000;
const RRF_K = 60;

export type EvidenceSource =
  | 'full-article'
  | 'focus-anchor'
  | 'exact-match'
  | 'global-search'
  | 'planned-need'
  | 'document-coverage';

export interface AssembledEvidence {
  chunk: ArticleChunk;
  sources: EvidenceSource[];
  reasons: string[];
  score: number;
  pinned: boolean;
}

export interface ContextAssembly {
  chunks: ArticleChunk[];
  evidence: AssembledEvidence[];
  history: ModelMessage[];
  conversationCheckpoint: ConversationCheckpoint | null;
  memory: ConversationMemorySelection;
  mode: ArticleContextMode;
  isTruncated: boolean;
  strategy: 'full-context' | 'fused-retrieval';
  needsPlanning: boolean;
  budget: {
    limit: number;
    fullArticleCharacters: number;
    articleCharacters: number;
    historyCharacters: number;
    checkpointCharacters: number;
  };
}

export interface AssembleQuestionContextInput {
  article: ArticleDocument;
  chunks: ArticleChunk[];
  question: string;
  focus: FocusContext | null;
  history: ChatMessage[];
  plan?: QueryPlan | null;
  conversationCheckpoint?: ConversationCheckpoint | null;
  planningComplete?: boolean;
  characterBudget?: number;
}

interface RankedEvidence extends AssembledEvidence {
  key: string;
  needIndexes: Set<number>;
}

function chunkLength(chunk: ArticleChunk): number {
  return chunk.section.length + chunk.text.length + 3;
}

function messageLength(message: ModelMessage): number {
  if (typeof message.content === 'string') return message.content.length;
  return message.content.reduce(
    (total, part) =>
      total +
      (part.type === 'text' ? part.text.length : part.image_url.url.length),
    0,
  );
}

function messagesLength(messages: ModelMessage[]): number {
  return messages.reduce(
    (total, message) => total + messageLength(message),
    0,
  );
}

function evidenceKey(chunk: ArticleChunk): string {
  return [...chunk.blockIds].sort().join('\u0000') || chunk.id;
}

function addEvidenceList(
  candidates: Map<string, RankedEvidence>,
  chunks: ArticleChunk[],
  options: {
    source: EvidenceSource;
    reason: string;
    weight: number;
    pinned?: boolean;
    needIndex?: number;
  },
): void {
  for (const [rank, chunk] of chunks.entries()) {
    const key = evidenceKey(chunk);
    const blockIds = new Set(chunk.blockIds);
    const overlapping = [...candidates.values()].filter(
      (candidate) =>
        candidate.key === key ||
        candidate.chunk.blockIds.some((blockId) => blockIds.has(blockId)),
    );
    const score =
      overlapping.reduce(
        (total, candidate) => total + candidate.score,
        0,
      ) +
      options.weight / (RRF_K + rank + 1);
    const sources = new Set(
      overlapping.flatMap((candidate) => candidate.sources),
    );
    const reasons = new Set(
      overlapping.flatMap((candidate) => candidate.reasons),
    );
    const needIndexes = new Set(
      overlapping.flatMap((candidate) => [...candidate.needIndexes]),
    );
    sources.add(options.source);
    reasons.add(options.reason);
    if (options.needIndex != null) needIndexes.add(options.needIndex);
    const selectedChunk = [
      ...overlapping.map((item) => ({
        chunk: item.chunk,
        pinned: item.pinned,
      })),
      { chunk, pinned: Boolean(options.pinned) },
    ]
      .toSorted(
        (left, right) =>
          Number(right.pinned) - Number(left.pinned) ||
          right.chunk.blockIds.length - left.chunk.blockIds.length ||
          right.chunk.text.length - left.chunk.text.length,
      )[0]?.chunk as ArticleChunk;
    const selectedKey = overlapping[0]?.key ?? key;
    for (const candidate of overlapping) candidates.delete(candidate.key);
    candidates.set(selectedKey, {
      key: selectedKey,
      chunk: selectedChunk,
      sources: [...sources],
      reasons: [...reasons],
      score,
      pinned: Boolean(
        overlapping.some((candidate) => candidate.pinned) ||
          options.pinned,
      ),
      needIndexes,
    });
  }
}

function packEvidence(
  candidates: RankedEvidence[],
  plan: QueryPlan | null | undefined,
  characterBudget: number,
): AssembledEvidence[] {
  const selected: RankedEvidence[] = [];
  const selectedKeys = new Set<string>();
  let usedCharacters = 0;

  const add = (candidate: RankedEvidence | undefined): boolean => {
    if (
      !candidate ||
      selectedKeys.has(candidate.key) ||
      selected.length >= DEFAULT_RELEVANT_CHUNK_LIMIT
    ) {
      return false;
    }
    const length = chunkLength(candidate.chunk);
    if (usedCharacters + length > characterBudget) return false;
    selected.push(candidate);
    selectedKeys.add(candidate.key);
    usedCharacters += length;
    return true;
  };

  const ranked = candidates.toSorted(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) ||
      right.score - left.score ||
      left.chunk.id.localeCompare(right.chunk.id),
  );
  for (const candidate of ranked.filter((item) => item.pinned)) {
    add(candidate);
  }

  for (const [needIndex] of (plan?.evidenceNeeds ?? []).entries()) {
    add(
      ranked.find(
        (candidate) =>
          candidate.needIndexes.has(needIndex) &&
          !selectedKeys.has(candidate.key),
      ),
    );
  }

  if (
    plan?.coverage === 'document-wide' ||
    candidates.some((item) =>
      item.sources.includes('document-coverage'),
    )
  ) {
    for (const candidate of ranked.filter((item) =>
      item.sources.includes('document-coverage'),
    )) {
      add(candidate);
    }
  }

  for (const candidate of ranked) add(candidate);

  return selected.map(({ key: _key, needIndexes: _needs, ...item }) => item);
}

function fullArticleEvidence(chunks: ArticleChunk[]): AssembledEvidence[] {
  return chunks.map((chunk) => ({
    chunk,
    sources: ['full-article'],
    reasons: ['全文与必要对话记忆可共同放入上下文预算。'],
    score: 1,
    pinned: false,
  }));
}

function selectHistory(
  history: ChatMessage[],
  question: string,
  focus: FocusContext | null,
  characterBudget: number,
): ConversationMemorySelection {
  return selectConversationMemory(history, {
    question,
    focusText: focus?.text,
    characterBudget,
    recentCharacterBudget: Math.min(characterBudget, 8_000),
  });
}

export function assembleQuestionContext(
  input: AssembleQuestionContextInput,
): ContextAssembly {
  const characterBudget = Math.max(
    1,
    input.characterBudget ?? REQUEST_CONTEXT_CHARACTER_BUDGET,
  );
  const conversationCheckpoint = input.conversationCheckpoint ?? null;
  const checkpointCharacters = conversationCheckpoint
    ? JSON.stringify(conversationCheckpoint).length
    : 0;
  const availableBudget = Math.max(1, characterBudget - checkpointCharacters);
  const fullArticleCharacters = input.chunks.reduce(
    (total, chunk) => total + chunkLength(chunk),
    0,
  );
  if (fullArticleCharacters <= availableBudget) {
    const memory = selectHistory(
      input.history,
      input.question,
      input.focus,
      availableBudget - fullArticleCharacters,
    );
    return {
      chunks: input.chunks,
      evidence: fullArticleEvidence(input.chunks),
      history: memory.messages,
      conversationCheckpoint,
      memory,
      mode: 'whole',
      isTruncated: false,
      strategy: 'full-context',
      needsPlanning: false,
      budget: {
        limit: characterBudget,
        fullArticleCharacters,
        articleCharacters: fullArticleCharacters,
        historyCharacters: messagesLength(memory.messages),
        checkpointCharacters,
      },
    };
  }

  const historyLimit = Math.min(
    input.plan?.useConversation
      ? PLANNED_HISTORY_BUDGET
      : DEFAULT_RETRIEVED_HISTORY_BUDGET,
    availableBudget,
  );
  const memory = selectHistory(
    input.history,
    input.question,
    input.focus,
    historyLimit,
  );
  const historyCharacters = messagesLength(memory.messages);
  const articleBudget = Math.max(1, availableBudget - historyCharacters);
  const candidates = new Map<string, RankedEvidence>();

  if (input.focus) {
    const anchors = retrieveRelevantChunks(input.chunks, {
      question: input.question,
      focusText: input.focus.text,
      focusSection: input.focus.section,
      focusScope:
        input.focus.type === 'text' ? input.focus.scope : undefined,
      focusHeadingLevel:
        input.focus.type === 'text'
          ? input.focus.headingLevel
          : undefined,
      limit: FOCUS_ANCHOR_LIMIT,
      characterBudget: articleBudget,
    });
    addEvidenceList(candidates, anchors, {
      source: 'focus-anchor',
      reason: '用户显式引用的内容及其结构邻域。',
      weight: 2,
      pinned: true,
    });
  }

  const exactEvidence = retrieveExactMatchChunks(input.chunks, {
    question: input.question,
    focusText: input.focus?.text,
    limit: DEFAULT_RELEVANT_CHUNK_LIMIT,
    characterBudget: articleBudget,
  });
  addEvidenceList(candidates, exactEvidence, {
    source: 'exact-match',
    reason: '问题、引用或标识符与文章内容存在字面精确匹配。',
    weight: 1.5,
  });

  const globalQueries = [
    input.focus?.text ?? '',
    input.plan?.rewrittenQuestion ?? '',
    ...(input.plan?.queries ?? []),
  ].filter(Boolean);
  const globalEvidence = retrieveRelevantChunks(input.chunks, {
    question: input.question,
    searchQueries: globalQueries,
    limit: DEFAULT_RELEVANT_CHUNK_LIMIT,
    characterBudget: articleBudget,
  });
  addEvidenceList(candidates, globalEvidence, {
    source: 'global-search',
    reason: '使用问题、引用和规划查询进行全文召回。',
    weight: 1,
  });

  for (const [needIndex, need] of (
    input.plan?.evidenceNeeds ?? []
  ).entries()) {
    const evidence = retrieveRelevantChunks(input.chunks, {
      question: need.query,
      limit: EVIDENCE_NEED_LIMIT,
      characterBudget: articleBudget,
    });
    addEvidenceList(candidates, evidence, {
      source: 'planned-need',
      reason: need.reason,
      weight: 1.25,
      needIndex,
    });
  }

  if (
    input.plan?.coverage === 'document-wide' ||
    isWholeArticleQuestion(input.question)
  ) {
    addEvidenceList(
      candidates,
      selectDocumentCoverage(
        input.chunks,
        Math.min(articleBudget, DOCUMENT_COVERAGE_BUDGET),
      ),
      {
        source: 'document-coverage',
        reason: '问题需要覆盖文章不同位置。',
        weight: 0.75,
      },
    );
  }

  const evidence = packEvidence(
    [...candidates.values()],
    input.plan,
    articleBudget,
  );
  const articleCharacters = evidence.reduce(
    (total, item) => total + chunkLength(item.chunk),
    0,
  );

  return {
    chunks: evidence.map((item) => item.chunk),
    evidence,
    history: memory.messages,
    conversationCheckpoint,
    memory,
    mode: 'relevant',
    isTruncated: true,
    strategy: 'fused-retrieval',
    needsPlanning: !input.planningComplete,
    budget: {
      limit: characterBudget,
      fullArticleCharacters,
      articleCharacters,
      historyCharacters,
      checkpointCharacters,
    },
  };
}
