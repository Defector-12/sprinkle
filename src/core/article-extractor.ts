import type {
  ArticleBlock,
  ArticleBlockType,
  ArticleDiagnostics,
  ArticleDocument,
  ArticleFormula,
  ArticleImage,
  ArticleRootKind,
  ArticleTable,
} from './types.ts';
import { sanitizeMathMl } from './mathml.ts';

export const MINIMUM_READABLE_LENGTH = 80;

const CONTENT_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'pre',
  'blockquote',
  'ul',
  'ol',
].join(',');

const EXCLUDED_ANCESTORS = [
  'nav',
  'footer',
  'aside',
  'form',
  'button',
  '[role="navigation"]',
  '[role="toolbar"]',
  '[role="group"]',
  '[aria-hidden="true"]',
].join(',');

const CUSTOM_CONTENT_ROOT_SELECTOR = [
  '[data-testid="longformContent"]',
  '[data-testid="articleText"]',
  '[data-testid="tweetText"]',
].join(',');

const CUSTOM_TEXT_ELEMENT_SELECTOR = 'div, span';
const VISUAL_SELECTOR = [
  'img',
  'canvas',
  'figure svg',
  'svg[role="img"]',
  'svg[aria-label]',
].join(',');

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function readableElementText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const excluded of clone.querySelectorAll(
    '.katex, math, script, style, [aria-hidden="true"]',
  )) {
    excluded.remove();
  }
  return cleanText(clone.textContent);
}

function blockTypeFor(element: Element): ArticleBlockType {
  const tagName = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tagName)) return 'heading';
  if (tagName === 'pre') return 'code';
  if (tagName === 'blockquote') return 'quote';
  if (tagName === 'ul' || tagName === 'ol') return 'list';
  return 'paragraph';
}

function headingLevel(element: Element): number | undefined {
  const match = /^h([1-6])$/i.exec(element.tagName);
  return match?.[1] ? Number(match[1]) : undefined;
}

function isTableOfContentsList(element: Element): boolean {
  if (!element.matches('ul, ol')) return false;
  const links = [...element.querySelectorAll('a[href*="#"]')];
  if (links.length < 3) return false;
  return links.every((link) => {
    const href = link.getAttribute('href') ?? '';
    return href.includes('#') && cleanText(link.textContent).length > 0;
  });
}

function hasDirectReadableText(element: Element): boolean {
  return [...element.childNodes].some(
    (node) =>
      node.nodeType === Node.TEXT_NODE && cleanText(node.textContent).length > 0,
  );
}

function hasReadableTextDescendant(element: Element): boolean {
  return [...element.querySelectorAll(CUSTOM_TEXT_ELEMENT_SELECTOR)].some(
    (descendant) =>
      descendant !== element &&
      !descendant.closest(EXCLUDED_ANCESTORS) &&
      hasDirectReadableText(descendant),
  );
}

function customTextElements(root: Element): Element[] {
  const preferredRoots = [...root.querySelectorAll(CUSTOM_CONTENT_ROOT_SELECTOR)];
  const searchRoots = preferredRoots.length ? preferredRoots : [root];
  const elements: Element[] = [];

  for (const searchRoot of searchRoots) {
    const candidates = [
      ...(searchRoot.matches(CUSTOM_TEXT_ELEMENT_SELECTOR)
        ? [searchRoot]
        : []),
      ...searchRoot.querySelectorAll(CUSTOM_TEXT_ELEMENT_SELECTOR),
    ];
    for (const candidate of candidates) {
      if (candidate.closest(EXCLUDED_ANCESTORS)) continue;
      const text = cleanText(candidate.textContent);
      if (!text) continue;
      if (
        !hasDirectReadableText(candidate) &&
        hasReadableTextDescendant(candidate)
      ) {
        continue;
      }
      elements.push(candidate);
    }
  }

  return elements;
}

function fallbackBlocks(root: Element, section: string): ArticleBlock[] {
  const seen = new Set<string>();
  const blocks: ArticleBlock[] = [];

  for (const element of customTextElements(root)) {
    const text = cleanText(element.textContent);
    if (text.length < 2 || seen.has(text)) continue;
    seen.add(text);
    blocks.push({
      id: `block-${blocks.length + 1}`,
      type: 'paragraph',
      text,
      section,
      order: blocks.length,
    });
  }

  return blocks;
}

function findArticleRoot(source: Document): {
  element: Element;
  kind: ArticleRootKind;
} {
  const article = source.querySelector('article');
  if (article) return { element: article, kind: 'article' };
  const main = source.querySelector('main');
  if (main) return { element: main, kind: 'main' };
  const roleMain = source.querySelector('[role="main"]');
  if (roleMain) return { element: roleMain, kind: 'role-main' };
  return { element: source.body, kind: 'body' };
}

function findSection(root: Element, target: Element, fallback: string): string {
  let section = fallback;
  const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');

  for (const heading of headings) {
    const relationship = heading.compareDocumentPosition(target);
    if (relationship & Node.DOCUMENT_POSITION_FOLLOWING) {
      section = cleanText(heading.textContent) || section;
      continue;
    }
    break;
  }

  return section;
}

function nearbyText(image: Element): string {
  const figure = image.closest('figure');
  const parts = [
    figure?.previousElementSibling?.textContent,
    figure?.querySelector('figcaption')?.textContent,
    figure?.nextElementSibling?.textContent,
    image.previousElementSibling?.textContent,
    image.nextElementSibling?.textContent,
  ]
    .map(cleanText)
    .filter(Boolean);

  return [...new Set(parts)].join(' ').slice(0, 800);
}

function resolveImageUrl(source: string, pageUrl: string): string {
  try {
    return new URL(source, pageUrl).toString();
  } catch {
    return source;
  }
}

function srcsetSource(value: string | null): string {
  const candidates = (value ?? '')
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter((candidate): candidate is string => Boolean(candidate));
  return candidates.at(-1) ?? '';
}

function visualSource(element: Element, pageUrl: string): string {
  if (element instanceof HTMLImageElement) {
    const source =
      element.getAttribute('data-src') ||
      element.getAttribute('data-original') ||
      element.getAttribute('data-lazy-src') ||
      element.currentSrc ||
      element.getAttribute('src') ||
      srcsetSource(
        element.getAttribute('data-srcset') ||
          element.getAttribute('srcset'),
      );
    return source ? resolveImageUrl(source, pageUrl) : '';
  }

  if (element instanceof HTMLCanvasElement) {
    try {
      return element.toDataURL('image/png');
    } catch {
      return '';
    }
  }

  if (element.tagName.toLowerCase() === 'svg') {
    const clone = element.cloneNode(true) as Element;
    if (!clone.hasAttribute('xmlns')) {
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    const serialized = new XMLSerializer().serializeToString(clone);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
  }

  return '';
}

function visualAlt(element: Element): string {
  return cleanText(
    element.getAttribute('alt') ||
      element.getAttribute('aria-label') ||
      element.querySelector('title')?.textContent,
  );
}

function structureOrder(
  target: Element,
  blockElements: Element[],
  blocks: ArticleBlock[],
  section: string,
): number {
  if (blockElements.length === blocks.length) {
    const containingBlockIndex = blockElements.findIndex(
      (element) => element === target || element.contains(target),
    );
    if (containingBlockIndex >= 0) return containingBlockIndex + 1;

    return blockElements.filter(
      (element) =>
        Boolean(
          element.compareDocumentPosition(target) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
    ).length;
  }

  const lastSectionIndex = blocks.findLastIndex(
    (block) => block.section === section,
  );
  return lastSectionIndex >= 0 ? lastSectionIndex + 1 : blocks.length;
}

function extractTables(
  root: Element,
  title: string,
  blockElements: Element[],
  blocks: ArticleBlock[],
): ArticleTable[] {
  const tables: ArticleTable[] = [];
  for (const table of root.querySelectorAll('table')) {
    if (table.closest(EXCLUDED_ANCESTORS)) continue;
    const rows = [...table.querySelectorAll('tr')]
      .map((row) => ({
        cells: [...row.children]
          .filter((cell) => cell.matches('th, td'))
          .map((cell) => ({
            text: readableElementText(cell),
            header: cell.tagName.toLowerCase() === 'th',
            colSpan: Math.max(
              1,
              Number.parseInt(cell.getAttribute('colspan') || '1', 10) || 1,
            ),
            rowSpan: Math.max(
              1,
              Number.parseInt(cell.getAttribute('rowspan') || '1', 10) || 1,
            ),
          }))
          .filter((cell) => cell.text),
      }))
      .filter((row) => row.cells.length > 0);
    if (!rows.length) continue;

    const section = findSection(root, table, title);
    tables.push({
      id: `table-${tables.length + 1}`,
      caption: cleanText(table.querySelector('caption')?.textContent),
      section,
      order: structureOrder(table, blockElements, blocks, section),
      rows,
    });
  }
  return tables;
}

function extractFormulas(
  root: Element,
  title: string,
  blockElements: Element[],
  blocks: ArticleBlock[],
): ArticleFormula[] {
  const formulas: ArticleFormula[] = [];
  for (const math of root.querySelectorAll('math')) {
    if (math.closest(EXCLUDED_ANCESTORS)) continue;
    const mathml = sanitizeMathMl(math.outerHTML);
    const tex = cleanText(
      math.querySelector(
        'annotation[encoding="application/x-tex"], annotation[encoding="text/tex"]',
      )?.textContent,
    );
    if (!mathml && !tex) continue;

    const section = findSection(root, math, title);
    formulas.push({
      id: `formula-${formulas.length + 1}`,
      tex: tex || cleanText(math.textContent),
      mathml,
      section,
      order: structureOrder(math, blockElements, blocks, section),
      display:
        math.getAttribute('display') === 'block' ||
        Boolean(math.closest('.katex-display'))
          ? 'block'
          : 'inline',
    });
  }
  return formulas;
}

export function extractArticle(
  source: Document,
  pageUrl: string,
): ArticleDocument {
  const rootSelection = findArticleRoot(source);
  const root = rootSelection.element;
  const firstHeading = root.querySelector('h1');
  const title =
    cleanText(firstHeading?.textContent) ||
    cleanText(source.title) ||
    new URL(pageUrl).hostname;

  let currentSection = title;
  const blocks: ArticleBlock[] = [];
  const blockElements: Element[] = [];
  const candidateBlocks = root.querySelectorAll(CONTENT_SELECTOR);
  let excludedBlockCount = 0;
  let emptyBlockCount = 0;

  for (const element of candidateBlocks) {
    if (
      element.closest(EXCLUDED_ANCESTORS) ||
      isTableOfContentsList(element)
    ) {
      excludedBlockCount += 1;
      continue;
    }

    const text = readableElementText(element);
    if (!text) {
      emptyBlockCount += 1;
      continue;
    }

    const type = blockTypeFor(element);
    if (type === 'heading') currentSection = text;

    const level = headingLevel(element);
    blocks.push({
      id: `block-${blocks.length + 1}`,
      type,
      text,
      section: currentSection,
      order: blocks.length,
      ...(level ? { level } : {}),
    });
    blockElements.push(element);
  }

  let readableLength = blocks.reduce(
    (total, block) => total + block.text.length,
    0,
  );
  let fallbackUsed = false;
  let fallbackBlockCount = 0;

  if (readableLength < MINIMUM_READABLE_LENGTH) {
    const recoveredBlocks = fallbackBlocks(root, title);
    const recoveredLength = recoveredBlocks.reduce(
      (total, block) => total + block.text.length,
      0,
    );
    if (recoveredLength > readableLength) {
      blocks.splice(0, blocks.length, ...recoveredBlocks);
      blockElements.splice(0, blockElements.length);
      readableLength = recoveredLength;
      fallbackUsed = true;
      fallbackBlockCount = recoveredBlocks.length;
    }
  }

  const seenImages = new Set<string>();
  const images: ArticleImage[] = [];

  for (const visual of root.querySelectorAll(VISUAL_SELECTOR)) {
    if (visual.closest(EXCLUDED_ANCESTORS)) continue;
    const src = visualSource(visual, pageUrl);
    if (!src || seenImages.has(src)) continue;
    seenImages.add(src);

    const figure = visual.closest('figure');
    const section = findSection(root, visual, title);
    images.push({
      id: `image-${images.length + 1}`,
      src,
      alt: visualAlt(visual),
      caption: cleanText(figure?.querySelector('figcaption')?.textContent),
      section,
      surroundingText: nearbyText(visual),
      order: structureOrder(visual, blockElements, blocks, section),
    });
  }
  const tables = extractTables(root, title, blockElements, blocks);
  const formulas = extractFormulas(root, title, blockElements, blocks);

  const diagnostics: ArticleDiagnostics = {
    rootKind: rootSelection.kind,
    readableLength,
    minimumReadableLength: MINIMUM_READABLE_LENGTH,
    rootTextLength: cleanText(root.textContent).length,
    candidateBlockCount: candidateBlocks.length,
    acceptedBlockCount: blocks.length,
    excludedBlockCount,
    emptyBlockCount,
    articleCandidateCount: source.querySelectorAll('article').length,
    mainCandidateCount: source.querySelectorAll('main').length,
    roleMainCandidateCount: source.querySelectorAll('[role="main"]').length,
    iframeCount: root.querySelectorAll('iframe').length,
    canvasCount: root.querySelectorAll('canvas').length,
    tableCount: root.querySelectorAll('table').length,
    shadowRootCount: [...root.querySelectorAll('*')].filter(
      (element) => element.shadowRoot,
    ).length,
    loadingIndicatorCount: root.querySelectorAll(
      '[aria-busy="true"], [data-loading], .loading, .skeleton',
    ).length,
    fallbackUsed,
    fallbackBlockCount,
  };

  return {
    title,
    url: pageUrl,
    blocks,
    images,
    tables,
    formulas,
    isPartial: readableLength < MINIMUM_READABLE_LENGTH,
    diagnostics,
  };
}
