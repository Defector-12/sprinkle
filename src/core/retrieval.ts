import type { ArticleBlock, ArticleChunk } from './types.ts';

function pushChunk(
  chunks: ArticleChunk[],
  section: string,
  blocks: ArticleBlock[],
): void {
  if (!blocks.length) return;

  chunks.push({
    id: `chunk-${chunks.length + 1}`,
    section,
    text: blocks.map((block) => block.text).join('\n'),
    blockIds: blocks.map((block) => block.id),
  });
}

export function createArticleChunks(
  blocks: ArticleBlock[],
  maxCharacters = 1_800,
): ArticleChunk[] {
  const characterLimit = Math.max(1, Math.floor(maxCharacters));
  const chunks: ArticleChunk[] = [];
  let currentBlocks: ArticleBlock[] = [];
  let currentSection = blocks[0]?.section ?? 'Article';
  let currentLength = 0;

  const boundedBlocks = blocks.flatMap((block) => {
    if (block.text.length <= characterLimit) return [block];
    const pieces: ArticleBlock[] = [];
    for (let offset = 0; offset < block.text.length; offset += characterLimit) {
      pieces.push({
        ...block,
        id: `${block.id}-part-${pieces.length + 1}`,
        text: block.text.slice(offset, offset + characterLimit),
      });
    }
    return pieces;
  });

  for (const block of boundedBlocks) {
    const startsNewSection =
      currentBlocks.length > 0 && block.section !== currentSection;
    const exceedsLimit =
      currentBlocks.length > 0 &&
      currentLength + block.text.length + 1 > characterLimit;

    if (startsNewSection || exceedsLimit) {
      pushChunk(chunks, currentSection, currentBlocks);
      currentBlocks = [];
      currentLength = 0;
    }

    currentSection = block.section || currentSection;
    currentBlocks.push(block);
    currentLength += block.text.length + 1;
  }

  pushChunk(chunks, currentSection, currentBlocks);
  return chunks;
}

function tokensFor(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const tokens = new Set(
    normalized.match(/[\p{L}\p{N}_-]{2,}/gu)?.map((token) => token.trim()) ??
      [],
  );

  for (const match of normalized.matchAll(/[\u3400-\u9fff]+/g)) {
    const text = match[0];
    for (let index = 0; index < text.length - 1; index += 1) {
      tokens.add(text.slice(index, index + 2));
    }
  }

  return tokens;
}

function overlapScore(queryTokens: Set<string>, candidate: string): number {
  if (!queryTokens.size) return 0;
  const candidateTokens = tokensFor(candidate);
  let matches = 0;

  for (const token of queryTokens) {
    if (candidateTokens.has(token)) matches += 1;
  }

  return matches / queryTokens.size;
}

export interface RetrievalQuery {
  question: string;
  focusText?: string;
  limit?: number;
}

export function retrieveRelevantChunks(
  chunks: ArticleChunk[],
  query: RetrievalQuery,
): ArticleChunk[] {
  const questionTokens = tokensFor(query.question);
  const focusTokens = tokensFor(query.focusText ?? '');
  const limit = Math.max(1, query.limit ?? 5);

  return chunks
    .map((chunk, index) => {
      const combined = `${chunk.section}\n${chunk.text}`;
      const questionScore = overlapScore(questionTokens, combined);
      const focusScore = overlapScore(focusTokens, combined);
      const exactSectionBonus = query.question
        .toLowerCase()
        .includes(chunk.section.toLowerCase())
        ? 0.15
        : 0;

      return {
        chunk,
        index,
        score: questionScore * 0.7 + focusScore * 0.3 + exactSectionBonus,
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ chunk }) => chunk);
}
