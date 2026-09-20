import MiniSearch from 'minisearch';

import type {
  ArticleBlock,
  ArticleChunk,
  ArticleDocument,
  TextFocus,
} from './types.ts';

export const WHOLE_ARTICLE_CHARACTER_BUDGET = 64_000;
export const RELEVANT_CONTEXT_CHARACTER_BUDGET = 24_000;
export const DEFAULT_RELEVANT_CHUNK_LIMIT = 8;
export const RETRIEVAL_CHUNK_TARGET = 900;
export const RETRIEVAL_CHUNK_HARD_MAXIMUM = 1_200;
const RETRIEVAL_CANDIDATE_LIMIT = 20;
const RETRIEVAL_WINDOW_RADIUS = 1;
const RECIPROCAL_RANK_FUSION_K = 60;

const RETRIEVAL_STOP_WORDS = new Set([
  'an',
  'and',
  'about',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'did',
  'do',
  'does',
  'explain',
  'for',
  'from',
  'has',
  'have',
  'how',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'should',
  'that',
  'the',
  'this',
  'to',
  'use',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'why',
  'will',
  'with',
  '为什么',
  '什么',
  '哪些',
  '如何',
  '怎么',
  '这个',
  '这篇',
]);

export type ArticleContextMode = 'relevant' | 'whole';

export interface ArticleContextSelection {
  chunks: ArticleChunk[];
  mode: ArticleContextMode;
  isTruncated: boolean;
}

interface ChunkBlock {
  block: ArticleBlock;
  separatorBefore: string;
  forceChunkStart: boolean;
}

function pushChunk(
  chunks: ArticleChunk[],
  section: string,
  entries: ChunkBlock[],
): void {
  if (!entries.length) return;

  chunks.push({
    id: `chunk-${chunks.length + 1}`,
    section,
    text: entries
      .map(({ block, separatorBefore }, index) =>
        `${index === 0 ? '' : separatorBefore}${block.text}`,
      )
      .join(''),
    blockIds: entries.map(({ block }) => block.id),
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

type TextSplitter = (value: string) => string[];

function splitAfterMatches(value: string, pattern: RegExp): string[] {
  const segments: string[] = [];
  let start = 0;
  for (const match of value.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end > start) segments.push(value.slice(start, end));
    start = end;
  }
  if (start < value.length) segments.push(value.slice(start));
  return segments.filter(Boolean);
}

function splitParagraphs(value: string): string[] {
  return splitAfterMatches(value, /\n{2,}/g);
}

function fallbackSentenceSegments(value: string): string[] {
  const segments: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (!/[。！？；.!?]/u.test(value[index] ?? '')) continue;
    let end = index + 1;
    while (end < value.length && /["'”’）)\]]/u.test(value[end] ?? '')) {
      end += 1;
    }
    while (end < value.length && /\s/u.test(value[end] ?? '')) end += 1;
    segments.push(value.slice(start, end));
    start = end;
    index = end - 1;
  }
  if (start < value.length) segments.push(value.slice(start));
  return segments.filter(Boolean);
}

function splitSentences(value: string): string[] {
  if (
    typeof Intl !== 'undefined' &&
    typeof Intl.Segmenter === 'function'
  ) {
    return [...new Intl.Segmenter(undefined, {
      granularity: 'sentence',
    }).segment(value)].map(({ segment }) => segment);
  }
  return fallbackSentenceSegments(value);
}

function splitClauses(value: string): string[] {
  return splitAfterMatches(value, /[，、,:：]+(?:\s+)?/gu);
}

function splitWhitespace(value: string): string[] {
  return splitAfterMatches(value, /\s+/gu);
}

function splitLines(value: string): string[] {
  return splitAfterMatches(value, /\n/g);
}

function splitCells(value: string): string[] {
  return splitAfterMatches(value, /\s*\|\s*/g);
}

function packSegments(segments: string[], hardMaximum: number): string[] {
  const packed: string[] = [];
  let current = '';
  for (const segment of segments) {
    if (current && current.length + segment.length > hardMaximum) {
      packed.push(current);
      current = '';
    }
    current += segment;
  }
  if (current) packed.push(current);
  return packed;
}

function splitRecursively(
  value: string,
  splitters: TextSplitter[],
  hardMaximum: number,
  splitterIndex = 0,
): string[] {
  if (value.length <= hardMaximum) return [value];
  if (splitterIndex >= splitters.length) {
    const pieces: string[] = [];
    for (let offset = 0; offset < value.length; offset += hardMaximum) {
      pieces.push(value.slice(offset, offset + hardMaximum));
    }
    return pieces;
  }

  const splitter = splitters[splitterIndex] as TextSplitter;
  const segments = splitter(value);
  if (segments.length <= 1) {
    return splitRecursively(
      value,
      splitters,
      hardMaximum,
      splitterIndex + 1,
    );
  }

  return packSegments(
    segments.flatMap((segment) =>
      segment.length <= hardMaximum
        ? [segment]
        : splitRecursively(
            segment,
            splitters,
            hardMaximum,
            splitterIndex + 1,
          ),
    ),
    hardMaximum,
  );
}

function tableParts(text: string, hardMaximum: number): string[] | null {
  const lines = text.split('\n');
  if (lines.length < 3) return null;
  const prefix = `${lines[0]}\n${lines[1]}`;
  const rowLimit = hardMaximum - prefix.length - 1;
  if (rowLimit < 1) return null;

  const rows = lines.slice(2).flatMap((row) =>
    splitRecursively(row, [splitCells, splitWhitespace], rowLimit),
  );
  const parts: string[] = [];
  let selectedRows: string[] = [];
  for (const row of rows) {
    const candidate = `${prefix}\n${[...selectedRows, row].join('\n')}`;
    if (selectedRows.length && candidate.length > hardMaximum) {
      parts.push(`${prefix}\n${selectedRows.join('\n')}`);
      selectedRows = [];
    }
    selectedRows.push(row);
  }
  if (selectedRows.length) {
    parts.push(`${prefix}\n${selectedRows.join('\n')}`);
  }
  return parts;
}

function splitBlock(
  block: ArticleBlock,
  hardMaximum: number,
): ChunkBlock[] {
  if (block.text.length <= hardMaximum) {
    return [{
      block,
      separatorBefore: '\n',
      forceChunkStart: false,
    }];
  }

  const isTable = block.id.startsWith('context-table-');
  const pieces = isTable
    ? tableParts(block.text, hardMaximum) ??
      splitRecursively(
        block.text,
        [splitLines, splitCells, splitWhitespace],
        hardMaximum,
      )
    : splitRecursively(
        block.text,
        block.type === 'code'
          ? [splitLines, splitWhitespace]
          : block.type === 'list'
            ? [splitLines, splitSentences, splitClauses, splitWhitespace]
            : [
                splitParagraphs,
                splitSentences,
                splitClauses,
                splitWhitespace,
              ],
        hardMaximum,
      );

  return pieces.map((text, index) => ({
    block: {
      ...block,
      id: `${block.id}-part-${index + 1}`,
      text,
    },
    separatorBefore: isTable ? '\n' : '',
    forceChunkStart: isTable && index > 0,
  }));
}

export function createArticleChunks(
  blocks: ArticleBlock[],
  targetCharacters = RETRIEVAL_CHUNK_TARGET,
  hardMaximumCharacters = targetCharacters === RETRIEVAL_CHUNK_TARGET
    ? RETRIEVAL_CHUNK_HARD_MAXIMUM
    : targetCharacters,
): ArticleChunk[] {
  const hardMaximum = Math.max(1, Math.floor(hardMaximumCharacters));
  const target = Math.min(
    hardMaximum,
    Math.max(1, Math.floor(targetCharacters)),
  );
  const chunks: ArticleChunk[] = [];
  let currentBlocks: ChunkBlock[] = [];
  let currentSection = blocks[0]?.section ?? 'Article';
  let currentLength = 0;

  const boundedBlocks = blocks.flatMap((block) =>
    splitBlock(block, hardMaximum),
  );

  for (const entry of boundedBlocks) {
    const { block } = entry;
    const startsNewSection =
      currentBlocks.length > 0 && block.section !== currentSection;
    const separatorLength =
      currentBlocks.length > 0 ? entry.separatorBefore.length : 0;
    const exceedsLimit =
      currentBlocks.length > 0 &&
      currentLength + separatorLength + block.text.length > hardMaximum;

    if (startsNewSection || exceedsLimit || entry.forceChunkStart) {
      pushChunk(chunks, currentSection, currentBlocks);
      currentBlocks = [];
      currentLength = 0;
    }

    currentSection = block.section || currentSection;
    currentBlocks.push(entry);
    currentLength +=
      (currentBlocks.length > 1 ? entry.separatorBefore.length : 0) +
      block.text.length;
    if (currentLength >= target) {
      pushChunk(chunks, currentSection, currentBlocks);
      currentBlocks = [];
      currentLength = 0;
    }
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
  searchQueries?: string[];
  focusText?: string;
  focusSection?: string;
  focusScope?: TextFocus['scope'];
  focusHeadingLevel?: number;
  limit?: number;
  characterBudget?: number;
}

export interface ExactMatchQuery {
  question: string;
  focusText?: string;
  limit?: number;
  characterBudget?: number;
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
  const focusTokens = tokensFor(query.focusText ?? '');
  const focusSectionTokens = tokensFor(query.focusSection ?? '');
  const limit = Math.max(1, query.limit ?? DEFAULT_RELEVANT_CHUNK_LIMIT);
  const normalizedFocus = (query.focusText ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedFocusSection = (query.focusSection ?? '')
    .toLowerCase()
    .trim();

  if (query.focusScope === 'section' && normalizedFocusSection) {
    const sectionPrefix = `${normalizedFocusSection} > `;
    const matches = chunks.filter((chunk) => {
      if (query.focusHeadingLevel === 1) return true;
      const section = chunk.section.toLowerCase();
      return (
        section === normalizedFocusSection ||
        section.startsWith(sectionPrefix)
      );
    });
    const selected: ArticleChunk[] = [];
    let selectedLength = 0;
    const characterBudget =
      query.characterBudget ?? RELEVANT_CONTEXT_CHARACTER_BUDGET;
    for (const chunk of matches) {
      if (selected.length >= limit) break;
      const nextLength = selectedLength + chunkCharacterLength(chunk);
      if (nextLength > characterBudget) break;
      selected.push(chunk);
      selectedLength = nextLength;
    }
    if (selected.length) return selected;
  }

  if (focusTokens.size || focusSectionTokens.size) {
    const focusedChunks = chunks.map((chunk, index) => {
      const combined = `${chunk.section}\n${chunk.text}`;
      const focusScore = overlapScore(focusTokens, combined);
      const focusSectionScore = overlapScore(
        focusSectionTokens,
        chunk.section,
      );
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
      };
    });
    const exactSectionCandidates = normalizedFocusSection
      ? focusedChunks.filter(
          ({ chunk }) =>
            chunk.section.toLowerCase() === normalizedFocusSection,
        )
      : [];
    const anchor = (
      exactSectionCandidates.length ? exactSectionCandidates : focusedChunks
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

  return retrieveBm25Windows(
    chunks,
    [query.question, ...(query.searchQueries ?? [])],
    {
      limit,
      characterBudget:
        query.characterBudget ?? RELEVANT_CONTEXT_CHARACTER_BUDGET,
    },
  );
}

function retrievalTerms(value: string): string[] {
  const normalized = value.toLowerCase();
  const terms =
    normalized
      .match(/[a-z0-9_]+/g)
      ?.filter((term) => term.length >= 2 && !RETRIEVAL_STOP_WORDS.has(term)) ??
    [];

  for (const match of normalized.matchAll(/[\u3400-\u9fff]+/g)) {
    const text = match[0];
    if (text.length === 1) terms.push(text);
    for (let index = 0; index < text.length - 1; index += 1) {
      const term = text.slice(index, index + 2);
      if (!RETRIEVAL_STOP_WORDS.has(term)) terms.push(term);
    }
  }

  return terms;
}

interface SearchableChunk {
  id: string;
  index: number;
  section: string;
  text: string;
}

function buildChunkSearch(chunks: ArticleChunk[]): MiniSearch<SearchableChunk> {
  const search = new MiniSearch<SearchableChunk>({
    fields: ['section', 'text'],
    idField: 'id',
    storeFields: ['index'],
    tokenize: retrievalTerms,
    processTerm: (term) => term,
    searchOptions: {
      boost: { section: 3, text: 1 },
      combineWith: 'OR',
      prefix: false,
      fuzzy: false,
    },
  });
  search.addAll(
    chunks.map((chunk, index) => ({
      id: chunk.id,
      index,
      section: chunk.section,
      text: chunk.text,
    })),
  );
  return search;
}

function evidenceWindow(
  chunks: ArticleChunk[],
  anchorIndex: number,
  characterBudget: number,
  coveredIndexes: ReadonlySet<number>,
): { chunk: ArticleChunk; indexes: number[] } | null {
  const anchor = chunks[anchorIndex];
  if (!anchor || chunkCharacterLength(anchor) > characterBudget) return null;

  const indexes = [anchorIndex];
  let length = chunkCharacterLength(anchor);
  for (let distance = 1; distance <= RETRIEVAL_WINDOW_RADIUS; distance += 1) {
    for (const index of [anchorIndex - distance, anchorIndex + distance]) {
      const neighbor = chunks[index];
      if (
        !neighbor ||
        coveredIndexes.has(index) ||
        neighbor.section !== anchor.section
      ) {
        continue;
      }
      const addedLength = neighbor.text.length + 1;
      if (length + addedLength > characterBudget) continue;
      indexes.push(index);
      length += addedLength;
    }
  }

  indexes.sort((left, right) => left - right);
  const selected = indexes.map((index) => chunks[index] as ArticleChunk);
  return {
    chunk: {
      id: `window-${selected[0]?.id}-${selected.at(-1)?.id}`,
      section: anchor.section,
      text: selected.map((chunk) => chunk.text).join('\n'),
      blockIds: [...new Set(selected.flatMap((chunk) => chunk.blockIds))],
    },
    indexes,
  };
}

function normalizeLiteral(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function exactLiterals(query: ExactMatchQuery): string[] {
  const values: string[] = [];
  const add = (value: string | undefined) => {
    const normalized = normalizeLiteral(value ?? '');
    if (normalized.length >= 3) values.push(normalized);
  };
  add(query.focusText);

  for (const pattern of [
    /`([^`]+)`/gu,
    /"([^"]+)"/gu,
    /“([^”]+)”/gu,
    /‘([^’]+)’/gu,
    /「([^」]+)」/gu,
    /『([^』]+)』/gu,
  ]) {
    for (const match of query.question.matchAll(pattern)) add(match[1]);
  }

  for (const match of query.question.matchAll(
    /[\p{L}\p{N}_./:-]{3,}/gu,
  )) {
    const literal = normalizeLiteral(match[0]);
    if (!RETRIEVAL_STOP_WORDS.has(literal)) values.push(literal);
  }

  return [...new Set(values)].toSorted(
    (left, right) => right.length - left.length,
  );
}

export function retrieveExactMatchChunks(
  chunks: ArticleChunk[],
  query: ExactMatchQuery,
): ArticleChunk[] {
  if (!chunks.length) return [];
  const literals = exactLiterals(query);
  if (!literals.length) return [];

  const candidates = chunks
    .map((chunk, index) => {
      const content = normalizeLiteral(`${chunk.section}\n${chunk.text}`);
      const matches = literals.filter((literal) => content.includes(literal));
      return {
        index,
        longestMatch: Math.max(0, ...matches.map((match) => match.length)),
        matchCount: matches.length,
      };
    })
    .filter((candidate) => candidate.matchCount > 0)
    .toSorted(
      (left, right) =>
        right.longestMatch - left.longestMatch ||
        right.matchCount - left.matchCount ||
        left.index - right.index,
    );

  const limit = Math.max(1, query.limit ?? DEFAULT_RELEVANT_CHUNK_LIMIT);
  const characterBudget =
    query.characterBudget ?? RELEVANT_CONTEXT_CHARACTER_BUDGET;
  const selected: ArticleChunk[] = [];
  const coveredIndexes = new Set<number>();
  let usedCharacters = 0;
  for (const candidate of candidates) {
    if (selected.length >= limit || coveredIndexes.has(candidate.index)) {
      continue;
    }
    const window = evidenceWindow(
      chunks,
      candidate.index,
      characterBudget - usedCharacters,
      coveredIndexes,
    );
    if (!window) continue;
    selected.push(window.chunk);
    usedCharacters += chunkCharacterLength(window.chunk);
    for (const index of window.indexes) coveredIndexes.add(index);
  }
  return selected;
}

function retrieveBm25Windows(
  chunks: ArticleChunk[],
  questions: string[],
  options: { limit: number; characterBudget: number },
): ArticleChunk[] {
  if (!chunks.length) return [];

  const search = buildChunkSearch(chunks);
  const fusedCandidates = new Map<
    number,
    { index: number; score: number; bestRank: number }
  >();
  const seenQuestions = new Set<string>();
  const uniqueQuestions = questions
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!key || seenQuestions.has(key)) return false;
      seenQuestions.add(key);
      return true;
    });
  for (const question of uniqueQuestions) {
    const queryTerms = new Set(retrievalTerms(question));
    if (!queryTerms.size) continue;
    const minimumTermMatches = queryTerms.size >= 3 ? 2 : 1;
    const results = search
      .search(question)
      .filter((result) => result.terms.length >= minimumTermMatches)
      .slice(0, RETRIEVAL_CANDIDATE_LIMIT);
    for (const [rank, result] of results.entries()) {
      const index = Number(result.index);
      if (!Number.isInteger(index)) continue;
      const current = fusedCandidates.get(index);
      const score =
        (current?.score ?? 0) +
        1 / (RECIPROCAL_RANK_FUSION_K + rank + 1);
      fusedCandidates.set(index, {
        index,
        score,
        bestRank: Math.min(current?.bestRank ?? rank, rank),
      });
    }
  }
  const candidates = [...fusedCandidates.values()].sort(
    (left, right) =>
      right.score - left.score ||
      left.bestRank - right.bestRank ||
      left.index - right.index,
  );
  const selected: ArticleChunk[] = [];
  const coveredIndexes = new Set<number>();
  let usedCharacters = 0;

  for (const candidate of candidates) {
    if (selected.length >= options.limit) break;
    const { index } = candidate;
    if (coveredIndexes.has(index)) continue;

    const remainingBudget = options.characterBudget - usedCharacters;
    const window = evidenceWindow(
      chunks,
      index,
      remainingBudget,
      coveredIndexes,
    );
    if (!window) continue;
    selected.push(window.chunk);
    usedCharacters += chunkCharacterLength(window.chunk);
    for (const coveredIndex of window.indexes) {
      coveredIndexes.add(coveredIndex);
    }
  }

  return selected;
}

function chunkCharacterLength(chunk: ArticleChunk): number {
  return chunk.section.length + chunk.text.length + 3;
}

interface CoverageGroup {
  key: string;
  chunks: Array<{ chunk: ArticleChunk; index: number }>;
}

function coverageGroups(chunks: ArticleChunk[]): CoverageGroup[] {
  const paths = chunks.map((chunk) =>
    chunk.section.split(' > ').map((part) => part.trim()).filter(Boolean),
  );
  const firstComponents = new Set(paths.map((path) => path[0] ?? 'Article'));
  const useSecondLevel =
    firstComponents.size === 1 && paths.some((path) => path.length > 1);
  const groups = new Map<string, CoverageGroup>();

  for (const [index, chunk] of chunks.entries()) {
    const path = paths[index] ?? [];
    const key = useSecondLevel
      ? path.slice(0, 2).join(' > ') || chunk.section
      : path[0] || chunk.section;
    const group = groups.get(key) ?? { key, chunks: [] };
    group.chunks.push({ chunk, index });
    groups.set(key, group);
  }
  return [...groups.values()];
}

function evenlySpacedIndexes(length: number, count: number): number[] {
  if (count <= 1) return [0];
  return [
    ...new Set(
      Array.from({ length: count }, (_, index) =>
        Math.round((index * (length - 1)) / (count - 1)),
      ),
    ),
  ];
}

function selectedCharacters(
  entries: Array<{ chunk: ArticleChunk; index: number }>,
): number {
  return entries.reduce(
    (total, entry) => total + chunkCharacterLength(entry.chunk),
    0,
  );
}

function selectAcrossDocument(
  chunks: ArticleChunk[],
  characterBudget: number,
  limit = DEFAULT_RELEVANT_CHUNK_LIMIT,
): ArticleChunk[] {
  if (!chunks.length || characterBudget <= 0 || limit <= 0) return [];
  const totalLength = chunks.reduce(
    (total, chunk) => total + chunkCharacterLength(chunk),
    0,
  );
  if (totalLength <= characterBudget && chunks.length <= limit) return chunks;

  const groups = coverageGroups(chunks);
  let selectedGroups: CoverageGroup[] = [];
  for (
    let count = Math.min(limit, groups.length);
    count >= 1;
    count -= 1
  ) {
    const candidateGroups = evenlySpacedIndexes(groups.length, count).map(
      (index) => groups[index] as CoverageGroup,
    );
    const leading = candidateGroups.map(
      (group) => group.chunks[0] as { chunk: ArticleChunk; index: number },
    );
    if (selectedCharacters(leading) <= characterBudget) {
      selectedGroups = candidateGroups;
      break;
    }
  }
  if (!selectedGroups.length) return [];

  const selected = selectedGroups.map(
    (group) => group.chunks[0] as { chunk: ArticleChunk; index: number },
  );
  const selectedIndexes = new Set(selected.map((entry) => entry.index));
  const selectedBlockIds = new Set(
    selected.flatMap((entry) => entry.chunk.blockIds),
  );
  let usedCharacters = selectedCharacters(selected);

  while (selected.length < limit) {
    const candidates = selectedGroups
      .map((group) => {
        const remaining = group.chunks.filter(
          (entry) =>
            !selectedIndexes.has(entry.index) &&
            !entry.chunk.blockIds.some((id) => selectedBlockIds.has(id)),
        );
        if (!remaining.length) return null;
        const representedCount = group.chunks.length - remaining.length;
        const firstIndex = group.chunks[0]?.index ?? 0;
        const lastIndex = group.chunks.at(-1)?.index ?? firstIndex;
        const middleIndex = (firstIndex + lastIndex) / 2;
        const candidate =
          representedCount === 1
            ? remaining.at(-1)
            : remaining.toSorted(
                (left, right) =>
                  Math.abs(left.index - middleIndex) -
                    Math.abs(right.index - middleIndex) ||
                  left.index - right.index,
              )[0];
        return {
          group,
          candidate,
          unrepresentedCharacters: selectedCharacters(remaining),
        };
      })
      .filter(
        (
          value,
        ): value is {
          group: CoverageGroup;
          candidate: { chunk: ArticleChunk; index: number };
          unrepresentedCharacters: number;
        } => Boolean(value?.candidate),
      )
      .toSorted(
        (left, right) =>
          right.unrepresentedCharacters - left.unrepresentedCharacters ||
          left.candidate.index - right.candidate.index,
      );
    const next = candidates.find(
      ({ candidate }) =>
        usedCharacters + chunkCharacterLength(candidate.chunk) <=
        characterBudget,
    );
    if (!next) break;
    selected.push(next.candidate);
    selectedIndexes.add(next.candidate.index);
    for (const id of next.candidate.chunk.blockIds) selectedBlockIds.add(id);
    usedCharacters += chunkCharacterLength(next.candidate.chunk);
  }

  return selected
    .toSorted((left, right) => left.index - right.index)
    .map(({ chunk }) => chunk);
}

export function selectDocumentCoverage(
  chunks: ArticleChunk[],
  characterBudget = WHOLE_ARTICLE_CHARACTER_BUDGET,
  limit = DEFAULT_RELEVANT_CHUNK_LIMIT,
): ArticleChunk[] {
  return selectAcrossDocument(chunks, characterBudget, limit);
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
    chunks.length,
  );
  return {
    chunks: selected,
    mode: 'whole',
    isTruncated: selected.length < chunks.length,
  };
}
