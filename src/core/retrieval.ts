import type {
  ArticleBlock,
  ArticleChunk,
  ArticleDocument,
} from './types.ts';

export const WHOLE_ARTICLE_CHARACTER_BUDGET = 64_000;

export type ArticleContextMode = 'relevant' | 'whole';

export interface ArticleContextSelection {
  chunks: ArticleChunk[];
  mode: ArticleContextMode;
  isTruncated: boolean;
}

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

export function articleContentBlocks(
  article: ArticleDocument,
): ArticleBlock[] {
  const entries: Array<{
    sourceOrder: number;
    priority: number;
    block: ArticleBlock;
  }> = article.blocks.map((block) => ({
    sourceOrder: block.order,
    priority: 1,
    block,
  }));

  for (const image of article.images) {
    const description = [
      image.alt,
      image.caption,
      image.surroundingText,
    ]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join('；');
    if (!description) continue;
    entries.push({
      sourceOrder: image.order ?? article.blocks.length,
      priority: 0,
      block: {
        id: `context-${image.id}`,
        type: 'paragraph',
        text: `图片说明：${description}`,
        section: image.section,
        order: 0,
      },
    });
  }

  for (const table of article.tables ?? []) {
    const rows = table.rows.map((row) =>
      row.cells.map((cell) => cell.text).join(' | '),
    );
    entries.push({
      sourceOrder: table.order,
      priority: 0,
      block: {
        id: `context-${table.id}`,
        type: 'paragraph',
        text: [
          table.caption ? `表格：${table.caption}` : '表格',
          ...rows,
        ].join('\n'),
        section: table.section,
        order: 0,
      },
    });
  }

  for (const formula of article.formulas ?? []) {
    if (!formula.tex) continue;
    entries.push({
      sourceOrder: formula.order,
      priority: 0,
      block: {
        id: `context-${formula.id}`,
        type: 'paragraph',
        text: `公式：${formula.tex}`,
        section: formula.section,
        order: 0,
      },
    });
  }

  return entries
    .sort(
      (left, right) =>
        left.sourceOrder - right.sourceOrder ||
        left.priority - right.priority,
    )
    .map(({ block }, order) => ({ ...block, order }));
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

export function tokensFor(value: string): Set<string> {
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

export function overlapScore(
  queryTokens: Set<string>,
  candidate: string,
): number {
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
  focusSection?: string;
  limit?: number;
}

export function isWholeArticleQuestion(question: string): boolean {
  const normalized = question.trim().toLowerCase();
  const chineseScope =
    /全文|全篇|整篇|全部|所有|整体|文章内容|网页内容|页面内容|文档内容|整个(?:文章|网页|页面|文档)|(?:这|本)篇(?:文章|网页|文档)/;
  const chineseTask =
    /总结|概括|梳理|归纳|提炼|整理|组织|分析|介绍|摘要|大纲|(?:核心|主要)?(?:观点|要点|主旨)|主要内容|讲了什么|说了什么/;
  const englishScope =
    /\b(?:all|everything|whole|entire|full|overall|article|page|document|content)\b/;
  const englishTask =
    /\b(?:summari[sz]e|summary|outline|overview|recap|main (?:idea|point|argument)s?)\b/;

  return (
    (chineseScope.test(normalized) && chineseTask.test(normalized)) ||
    (englishScope.test(normalized) && englishTask.test(normalized)) ||
    /\bwhat (?:is|does) (?:this|the) (?:article|page|document) (?:about|cover|discuss)\b/.test(
      normalized,
    )
  );
}

export function retrieveRelevantChunks(
  chunks: ArticleChunk[],
  query: RetrievalQuery,
): ArticleChunk[] {
  const questionTokens = tokensFor(query.question);
  const focusTokens = tokensFor(query.focusText ?? '');
  const focusSectionTokens = tokensFor(query.focusSection ?? '');
  const limit = Math.max(1, query.limit ?? 5);
  const normalizedFocus = (query.focusText ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedFocusSection = (query.focusSection ?? '')
    .toLowerCase()
    .trim();

  const scored = chunks.map((chunk, index) => {
    const combined = `${chunk.section}\n${chunk.text}`;
    const questionScore = overlapScore(questionTokens, combined);
    const focusScore = overlapScore(focusTokens, combined);
    const focusSectionScore = overlapScore(
      focusSectionTokens,
      chunk.section,
    );
    const exactSectionBonus = query.question
      .toLowerCase()
      .includes(chunk.section.toLowerCase())
      ? 0.15
      : 0;
    const normalizedCombined = combined
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const exactFocusBonus =
      normalizedFocus && normalizedCombined.includes(normalizedFocus)
        ? 0.5
        : 0;
    const exactFocusSectionBonus =
      normalizedFocusSection &&
      chunk.section.toLowerCase() === normalizedFocusSection
        ? 0.5
        : 0;

    return {
      chunk,
      index,
      focusAnchorScore:
        focusScore +
        focusSectionScore * 0.5 +
        exactFocusBonus +
        exactFocusSectionBonus,
      score: questionScore * 0.7 + focusScore * 0.3 + exactSectionBonus,
    };
  });

  if (focusTokens.size || focusSectionTokens.size) {
    const exactSectionCandidates = normalizedFocusSection
      ? scored.filter(
          ({ chunk }) =>
            chunk.section.toLowerCase() === normalizedFocusSection,
        )
      : [];
    const anchor = (
      exactSectionCandidates.length ? exactSectionCandidates : scored
    ).toSorted(
      (left, right) =>
        right.focusAnchorScore - left.focusAnchorScore ||
        left.index - right.index,
    )[0];
    if (anchor && anchor.focusAnchorScore > 0) {
      const anchorPath = anchor.chunk.section.split(' > ');
      const parentPath =
        anchorPath.length >= 3
          ? anchorPath.slice(0, -1).join(' > ')
          : '';
      const neighborIndexes = [
        anchor.index,
        anchor.index + 1,
        anchor.index - 1,
        anchor.index + 2,
        anchor.index - 2,
      ];
      const selectedIndexes = neighborIndexes
        .filter((index) => index >= 0 && index < chunks.length)
        .filter((index) => {
          if (index === anchor.index) return true;
          const section = (chunks[index] as ArticleChunk).section;
          return (
            section === anchor.chunk.section ||
            Boolean(parentPath && section.startsWith(`${parentPath} > `))
          );
        })
        .slice(0, Math.min(limit, 3));
      return selectedIndexes.map((index) => chunks[index] as ArticleChunk);
    }
  }

  return scored
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ chunk }) => chunk);
}

function chunkCharacterLength(chunk: ArticleChunk): number {
  return chunk.section.length + chunk.text.length + 3;
}

function selectAcrossDocument(
  chunks: ArticleChunk[],
  characterBudget: number,
): ArticleChunk[] {
  const totalLength = chunks.reduce(
    (total, chunk) => total + chunkCharacterLength(chunk),
    0,
  );
  if (totalLength <= characterBudget) return chunks;

  const largestChunkLength = Math.max(
    ...chunks.map(chunkCharacterLength),
  );
  const selectedCount = Math.max(
    1,
    Math.min(
      chunks.length,
      Math.floor(characterBudget / largestChunkLength),
    ),
  );
  if (selectedCount === 1) return [chunks[0] as ArticleChunk];

  return Array.from({ length: selectedCount }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (chunks.length - 1)) / (selectedCount - 1),
    );
    return chunks[sourceIndex] as ArticleChunk;
  });
}

export function selectArticleContext(
  chunks: ArticleChunk[],
  query: RetrievalQuery,
): ArticleContextSelection {
  if (!isWholeArticleQuestion(query.question)) {
    return {
      chunks: retrieveRelevantChunks(chunks, query),
      mode: 'relevant',
      isTruncated: false,
    };
  }

  const selected = selectAcrossDocument(
    chunks,
    WHOLE_ARTICLE_CHARACTER_BUDGET,
  );
  return {
    chunks: selected,
    mode: 'whole',
    isTruncated: selected.length < chunks.length,
  };
}
